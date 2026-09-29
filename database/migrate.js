// Safe, idempotent database setup for Hospital Café.
//
// IMPORTANT: this never drops orders, order_items, menu_items or any other
// table that holds business data. Every statement is CREATE TABLE IF NOT EXISTS
// or an "add column only if missing" change, so it is safe to run on every boot
// against a live production database.
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../config/passwordUtil');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(conn, table, column, ddl) {
  if (!(await columnExists(conn, table, column))) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${ddl}`);
    console.log(`✅ Migration: added ${table}.${column}`);
  }
}

async function runMigrations(pool) {
  const conn = await pool.getConnection();
  try {
    // ---------- Core tables (created only if missing; existing data is kept) ----------
    await conn.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        category ENUM('Breakfast', 'Lunch', 'Dinner', 'Main Course', 'Snacks', 'Beverages', 'Desserts') NOT NULL,
        description VARCHAR(500) DEFAULT '',
        serving VARCHAR(60) NOT NULL,
        food_type ENUM('veg', 'nonveg') NOT NULL,
        image VARCHAR(255) DEFAULT NULL,
        price DECIMAL(10,2) NOT NULL,
        available TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_number VARCHAR(50) UNIQUE NULL,
        transaction_id VARCHAR(100) UNIQUE NULL,
        room_number VARCHAR(20) NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'Test Payment',
        payment_status ENUM('Pending', 'Successful', 'Failed', 'Refunded', 'Cancelled') DEFAULT 'Successful',
        special_instructions VARCHAR(300) DEFAULT '',
        status ENUM('New', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Completed', 'Cancelled') NOT NULL DEFAULT 'New',
        cancellation_reason VARCHAR(255) NULL,
        cancelled_by VARCHAR(100) NULL,
        order_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        time_placed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        time_payment TIMESTAMP NULL,
        time_accepted TIMESTAMP NULL,
        time_preparing TIMESTAMP NULL,
        time_ready TIMESTAMP NULL,
        time_out_for_delivery TIMESTAMP NULL,
        time_delivered TIMESTAMP NULL
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        item_id INT NOT NULL,
        item_name VARCHAR(120) NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        quantity INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        CONSTRAINT fk_order_items_order
          FOREIGN KEY (order_id) REFERENCES orders(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id VARCHAR(100) DEFAULT 'Admin',
        action VARCHAR(255) NOT NULL,
        related_item VARCHAR(100) NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        portal ENUM('admin', 'diet_care') NOT NULL DEFAULT 'admin',
        is_super TINYINT(1) NOT NULL DEFAULT 0,
        status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_username_portal (username, portal)
      ) ENGINE=InnoDB;
    `);

    // ---------- Add-ons ----------
    // An add-on is a priced extra (e.g. "Extra Chicken +₹80"). It only appears on the
    // dishes it is linked to through menu_item_addons — never globally.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS addons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        available TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS menu_item_addons (
        menu_item_id INT NOT NULL,
        addon_id INT NOT NULL,
        PRIMARY KEY (menu_item_id, addon_id),
        CONSTRAINT fk_mia_item  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_mia_addon FOREIGN KEY (addon_id)     REFERENCES addons(id)     ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    // Extend order_items so an order line keeps base price, add-ons and total separately.
    // Old rows get addons_unit_total = 0, so historical orders stay valid.
    await addColumnIfMissing(conn, 'order_items', 'addons_unit_total', 'DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER unit_price');

    // Snapshot of the add-ons chosen on each order line (name + price at time of order),
    // so later price/name edits or deletions never change past orders.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS order_item_addons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_item_id INT NOT NULL,
        addon_id INT NULL,
        addon_name VARCHAR(100) NOT NULL,
        addon_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        CONSTRAINT fk_oia_order_item
          FOREIGN KEY (order_item_id) REFERENCES order_items(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    // ---------- Seed data (only when the tables are empty) ----------
    const [[{ menuCount }]] = await conn.query(`SELECT COUNT(*) AS menuCount FROM menu_items`);
    if (menuCount === 0) {
      const seedSql = fs.readFileSync(path.join(__dirname, 'seed_menu.sql'), 'utf8');
      await conn.query(seedSql);
      console.log('✅ Seeded starter menu items.');
    }

    // Example add-ons (Biriyani / Dosa / Tea). Skipped if any add-on already exists,
    // or if SEED_SAMPLE_ADDONS=false. Admin can edit or delete them from the dashboard.
    const [[{ addonCount }]] = await conn.query(`SELECT COUNT(*) AS addonCount FROM addons`);
    if (addonCount === 0 && process.env.SEED_SAMPLE_ADDONS !== 'false') {
      const samples = [
        { dishes: ['Chicken Biriyani'], addons: [['Extra Chicken', 80], ['Boiled Egg', 20], ['Raita', 15]] },
        { dishes: ['Dosa', 'Masala Dosa', 'Dinner Dosa'], addons: [['Extra Sambar', 20], ['Extra Chutney', 15], ['Cheese', 30]] },
        { dishes: ['Tea'], addons: [['Extra Sugar', 0], ['Ginger', 10]] }
      ];
      let created = 0;
      for (const group of samples) {
        const [dishRows] = await conn.query(
          `SELECT id FROM menu_items WHERE name IN (${group.dishes.map(() => '?').join(',')})`,
          group.dishes
        );
        if (dishRows.length === 0) continue; // dish not on this menu — skip its add-ons
        for (const [name, price] of group.addons) {
          const [res] = await conn.query('INSERT INTO addons (name, price, available) VALUES (?, ?, 1)', [name, price]);
          for (const d of dishRows) {
            await conn.query('INSERT INTO menu_item_addons (menu_item_id, addon_id) VALUES (?, ?)', [d.id, res.insertId]);
          }
          created++;
        }
      }
      if (created) console.log(`✅ Seeded ${created} sample add-ons.`);
    }

    // ---------- Admin account bootstrap ----------
    // Only when there is no admin account at all; never overwrites existing accounts.
    const [[{ adminCount }]] = await conn.query(`SELECT COUNT(*) AS adminCount FROM staff_users WHERE portal = 'admin'`);
    if (adminCount === 0 && process.env.ADMIN_PASSWORD) {
      await conn.query(
        `INSERT INTO staff_users (username, password_hash, portal, is_super, status) VALUES (?, ?, 'admin', 1, 'active')`,
        ['admin', hashPassword(process.env.ADMIN_PASSWORD)]
      );
      console.log('✅ Bootstrapped default super admin account (username: admin) from ADMIN_PASSWORD.');
    }

    // ---------- One-time Diet Care data cleanup (opt-in) ----------
    // The application no longer contains any Diet Care code. Old Diet Care tables/rows are
    // left untouched by default so no data is lost by surprise. Set REMOVE_DIET_CARE_DATA=true
    // for ONE deploy to permanently delete them, then remove the variable again.
    if (process.env.REMOVE_DIET_CARE_DATA === 'true') {
      await conn.query('DROP TABLE IF EXISTS diet_orders');
      await conn.query('DROP TABLE IF EXISTS diet_menu_items');
      await conn.query(`DELETE FROM staff_users WHERE portal = 'diet_care'`);
      await conn.query(`ALTER TABLE staff_users MODIFY portal ENUM('admin') NOT NULL DEFAULT 'admin'`);
      console.log('🧹 Removed legacy Diet Care tables and accounts.');
    }

    console.log('✅ Database ready (non-destructive migration complete).');
  } finally {
    conn.release();
  }
}

module.exports = { runMigrations };

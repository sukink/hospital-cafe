const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { issueToken, revokeToken, requireAdmin, requireSuperAdmin } = require('../config/adminAuth');
const { hashPassword, verifyPassword } = require('../config/passwordUtil');

// POST /api/admin/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT * FROM staff_users WHERE username = ? AND portal = 'admin' LIMIT 1`,
      [String(username).trim()]
    );
    const user = rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'This account has been disabled. Contact your super admin.' });
    }

    const token = issueToken({ id: user.id, username: user.username, is_super: !!user.is_super });
    return res.json({ success: true, token, username: user.username, is_super: !!user.is_super });
  } catch (err) {
    console.error('Admin Login Error:', err);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// POST /api/admin/logout
router.post('/logout', requireAdmin, (req, res) => {
  if (req.staffToken) revokeToken(req.staffToken);
  res.json({ success: true });
});

// ---------- Staff account management (Admin portal, super accounts only) ----------

// GET /api/admin/users — list all admin-portal accounts
router.get('/users', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, is_super, status, created_at FROM staff_users WHERE portal = 'admin' ORDER BY created_at ASC`
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    console.error('Admin Users List Error:', err);
    res.status(500).json({ success: false, message: 'Could not load staff accounts.' });
  }
});

// POST /api/admin/users — create a new admin-portal account
router.post('/users', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, is_super } = req.body || {};

    if (!username || !String(username).trim()) {
      return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    if (!password || String(password).length < 4) {
      return res.status(400).json({ success: false, message: 'Password must be at least 4 characters.' });
    }

    const cleanUsername = String(username).trim();
    const [existing] = await pool.query(
      `SELECT id FROM staff_users WHERE username = ? AND portal = 'admin' LIMIT 1`,
      [cleanUsername]
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'That username is already in use.' });
    }

    const [result] = await pool.query(
      `INSERT INTO staff_users (username, password_hash, portal, is_super, status) VALUES (?, ?, 'admin', ?, 'active')`,
      [cleanUsername, hashPassword(password), is_super ? 1 : 0]
    );

    res.json({ success: true, message: 'Account created.', id: result.insertId });
  } catch (err) {
    console.error('Admin User Create Error:', err);
    res.status(500).json({ success: false, message: 'Could not create account.' });
  }
});

// PATCH /api/admin/users/:id/status — activate/deactivate an admin-portal account
router.patch('/users/:id/status', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }
    if (Number(id) === req.staffUser.id && status === 'inactive') {
      return res.status(400).json({ success: false, message: "You can't disable your own account while logged in." });
    }

    const [result] = await pool.query(
      `UPDATE staff_users SET status = ? WHERE id = ? AND portal = 'admin'`,
      [status, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    res.json({ success: true, message: `Account ${status === 'active' ? 'activated' : 'disabled'}.` });
  } catch (err) {
    console.error('Admin User Status Update Error:', err);
    res.status(500).json({ success: false, message: 'Could not update account.' });
  }
});

// DELETE /api/admin/users/:id — delete an admin-portal account
router.delete('/users/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (Number(id) === req.staffUser.id) {
      return res.status(400).json({ success: false, message: "You can't delete your own account while logged in." });
    }

    const [result] = await pool.query(
      `DELETE FROM staff_users WHERE id = ? AND portal = 'admin'`,
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    res.json({ success: true, message: 'Account deleted.' });
  } catch (err) {
    console.error('Admin User Delete Error:', err);
    res.status(500).json({ success: false, message: 'Could not delete account.' });
  }
});

// 1. GET /api/admin/reports/daily - Daily & Date Range Report
router.get('/reports/daily', requireAdmin, async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    let dateCondition = `DATE(order_time) = CURDATE()`;
    let params = [];

    if (date) {
      dateCondition = `DATE(order_time) = ?`;
      params.push(date);
    } else if (startDate && endDate) {
      dateCondition = `DATE(order_time) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status IN ('Delivered', 'Completed') THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status NOT IN ('Delivered', 'Completed', 'Cancelled') THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(CASE WHEN payment_status = 'Successful' THEN 1 ELSE 0 END) as successful_transactions,
        SUM(CASE WHEN payment_status = 'Failed' THEN 1 ELSE 0 END) as failed_transactions,
        SUM(CASE WHEN payment_status = 'Pending' THEN 1 ELSE 0 END) as pending_transactions,
        SUM(CASE WHEN payment_status = 'Successful' THEN total_amount ELSE 0 END) as total_revenue,
        AVG(CASE WHEN payment_status = 'Successful' THEN total_amount ELSE NULL END) as average_order_value,
        AVG(TIMESTAMPDIFF(MINUTE, time_placed, time_ready)) as avg_prep_time,
        AVG(TIMESTAMPDIFF(MINUTE, time_ready, time_delivered)) as avg_delivery_time
      FROM orders WHERE ${dateCondition}
    `, params);

    // Revenue by category
    const [categoryRevenue] = await pool.query(`
      SELECT m.category, SUM(oi.amount) as revenue, SUM(oi.quantity) as items_sold, COUNT(DISTINCT o.id) as orders_count
      FROM order_items oi
      JOIN menu_items m ON oi.item_id = m.id
      JOIN orders o ON oi.order_id = o.id
      WHERE ${dateCondition.replace(/order_time/g, 'o.order_time')}
      GROUP BY m.category
    `, params);

    res.json({
      success: true,
      report: summary[0],
      categoryRevenue
    });
  } catch (err) {
    console.error('Daily Report Error:', err);
    res.status(500).json({ success: false, message: 'Could not generate report.' });
  }
});

// 1b. GET /api/admin/reports/orders-list - Per-order breakdown for export (Room No / Txn ID / Amount)
router.get('/reports/orders-list', requireAdmin, async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    let dateCondition = `DATE(order_time) = CURDATE()`;
    let params = [];

    if (date) {
      dateCondition = `DATE(order_time) = ?`;
      params.push(date);
    } else if (startDate && endDate) {
      dateCondition = `DATE(order_time) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    const [orders] = await pool.query(
      `SELECT id, order_number, room_number, transaction_id, total_amount, status, order_time
       FROM orders WHERE ${dateCondition} ORDER BY order_time DESC`,
      params
    );

    // Per-item breakdown (one row per food item ordered) for the detailed CSV export.
    let itemRows = [];
    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);
      const [items] = await pool.query(
        `SELECT * FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY order_id, id`,
        orderIds
      );
      const itemIds = items.map(i => i.id);
      let addonsByItem = new Map();
      if (itemIds.length > 0) {
        const [addonRows] = await pool.query(
          `SELECT order_item_id, addon_name, addon_price FROM order_item_addons
           WHERE order_item_id IN (${itemIds.map(() => '?').join(',')})`,
          itemIds
        );
        for (const a of addonRows) {
          if (!addonsByItem.has(a.order_item_id)) addonsByItem.set(a.order_item_id, []);
          addonsByItem.get(a.order_item_id).push(`${a.addon_name} (+₹${Number(a.addon_price)})`);
        }
      }
      const orderMeta = new Map(orders.map(o => [o.id, o]));
      itemRows = items.map(it => {
        const o = orderMeta.get(it.order_id) || {};
        return {
          order_number: o.order_number,
          room_number: o.room_number,
          order_time: o.order_time,
          status: o.status,
          item_name: it.item_name,
          quantity: it.quantity,
          addons: (addonsByItem.get(it.id) || []).join('; '),
          base_price: Number(it.unit_price),
          addon_price: Number(it.addons_unit_total || 0),
          line_total: Number(it.amount)
        };
      });
    }

    res.json({ success: true, orders, itemRows });
  } catch (err) {
    console.error('Orders List Report Error:', err);
    res.status(500).json({ success: false, message: 'Could not load order report.' });
  }
});

// 2. GET /api/admin/reports/room/:roomNumber - Room-wise history
router.get('/reports/room/:roomNumber', requireAdmin, async (req, res) => {
  try {
    const room = req.params.roomNumber.trim();
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_amount,
        SUM(CASE WHEN status IN ('Delivered', 'Completed') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status NOT IN ('Delivered', 'Completed', 'Cancelled') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM orders WHERE room_number = ?
    `, [room]);

    const [orders] = await pool.query(
      `SELECT id, order_number, transaction_id, room_number, total_amount, payment_status, status, special_instructions,
              cancellation_reason, order_time, time_placed, time_payment, time_accepted, time_preparing,
              time_ready, time_out_for_delivery, time_delivered
       FROM orders WHERE room_number = ? ORDER BY order_time DESC LIMIT 50`,
      [room]
    );

    res.json({
      success: true,
      roomSummary: summary[0],
      orders
    });
  } catch (err) {
    console.error('Room Report Error:', err);
    res.status(500).json({ success: false, message: 'Could not load room report.' });
  }
});

// 3. GET /api/admin/audit-logs - View admin activity logs
router.get('/audit-logs', requireAdmin, async (req, res) => {
  try {
    const [logs] = await pool.query(`SELECT * FROM admin_activity_logs ORDER BY timestamp DESC LIMIT 100`);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not fetch audit logs.' });
  }
});

module.exports = router;

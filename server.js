require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const path = require('path');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Hospital Cafe API is running.' });
});

// Fallback: send index.html for the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found.' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

app.listen(PORT, async () => {
  console.log(`Hospital Cafe server running at http://localhost:${PORT}`);
  
  try {
    const connection = await pool.getConnection();
    
    // Drop old tables to recreate with complete schema matching orders.js
    await connection.query('DROP TABLE IF EXISTS order_items;');
    await connection.query('DROP TABLE IF EXISTS orders;');
    await connection.query('DROP TABLE IF EXISTS menu_items;');
    await connection.query('DROP TABLE IF EXISTS admin_activity_logs;');

    // Create menu_items table
    await connection.query(`
      CREATE TABLE menu_items (
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

    // Create orders table with all timestamp columns expected by orders.js
    await connection.query(`
      CREATE TABLE orders (
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

    // Create order_items table
    await connection.query(`
      CREATE TABLE order_items (
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

    // Create admin logs table
    await connection.query(`
      CREATE TABLE admin_activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id VARCHAR(100) DEFAULT 'Admin',
        action VARCHAR(255) NOT NULL,
        related_item VARCHAR(100) NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // Seed upgraded menu items
    await connection.query(`
      INSERT INTO menu_items (name, category, description, serving, food_type, image, price, available) VALUES
      -- Breakfast
      ('Idly', 'Breakfast', 'Soft steamed South Indian rice cakes.', '2 Pieces', 'veg', 'idly.png', 50.00, 1),
      ('Dosa', 'Breakfast', 'Crispy traditional South Indian rice crepe.', '1 Piece', 'veg', 'dosa.png', 60.00, 1),
      ('Masala Dosa', 'Breakfast', 'Crispy dosa stuffed with spiced potato masala.', '1 Piece', 'veg', 'masala-dosa.png', 80.00, 1),
      ('Poori Masala', 'Breakfast', 'Fluffy deep-fried bread served with potato curry.', '2 Pieces', 'veg', 'poori.png', 75.00, 1),
      ('Oats Porridge', 'Breakfast', 'Healthy warm oats porridge, light on the stomach.', '1 Bowl', 'veg', 'oats.png', 60.00, 1),
      ('Bread Toast', 'Breakfast', 'Golden toasted bread slices with butter or jam.', '2 Slices', 'veg', 'bread-toast.png', 35.00, 1),
      ('Bread Omelette', 'Breakfast', 'Fluffy egg omelette folded inside toasted bread slices.', '1 Plate', 'nonveg', 'bread-omelette.png', 65.00, 1),

      -- Lunch
      ('Chicken Biriyani', 'Lunch', 'Aromatic basmati rice cooked with tender chicken and spices.', '1 Plate', 'nonveg', 'chicken-biriyani.png', 160.00, 1),
      ('Veg Biriyani', 'Lunch', 'Flavorful spiced rice cooked with fresh garden vegetables.', '1 Plate', 'veg', 'veg-biriyani.png', 120.00, 1),
      ('Curd Rice', 'Lunch', 'Soothing tempered curd rice, easy to digest.', '1 Bowl', 'veg', 'curd-rice.png', 55.00, 1),
      ('Khichdi', 'Lunch', 'Comforting lentil and rice porridge with mild spices.', '1 Bowl', 'veg', 'khichdi.png', 60.00, 1),
      ('North Indian Thali', 'Lunch', 'Complete meal with 2 rotis, dal, sabzi, rice, and raita.', '1 Plate', 'veg', 'thali.png', 170.00, 1),

      -- Dinner
      ('Dinner Dosa', 'Dinner', 'Light evening dosa served with chutney and sambhar.', '1 Piece', 'veg', 'dosa.png', 60.00, 1),
      ('Dinner Idly', 'Dinner', 'Soft warm idlys ideal for light evening recovery.', '2 Pieces', 'veg', 'idly.png', 50.00, 1),
      ('Veg Fried Rice', 'Dinner', 'Tossed wok rice with mixed vegetables and light soy.', '1 Plate', 'veg', 'veg-fried-rice.png', 110.00, 1),
      ('Chicken Fried Rice', 'Dinner', 'Wok-tossed fried rice with diced chicken and egg.', '1 Plate', 'nonveg', 'chicken-fried-rice.png', 140.00, 1),
      ('Egg Fried Rice', 'Dinner', 'Classic fried rice scrambled with fresh eggs.', '1 Plate', 'nonveg', 'egg-fried-rice.png', 120.00, 1),
      ('Chicken Pepper Masala', 'Dinner', 'Spicy semi-gravy chicken cooked with crushed black pepper.', '1 Plate', 'nonveg', 'pepper-chicken.png', 180.00, 1),

      -- Starters / Snacks
      ('Chicken Kabab', 'Snacks', 'Crispy, deep-fried spiced chicken pieces.', '5 Pieces', 'nonveg', 'chicken-kabab.png', 140.00, 1),
      ('Chicken Manchurian', 'Snacks', 'Juicy chicken chunks tossed in tangy manchurian sauce.', '1 Plate', 'nonveg', 'chicken-manchurian.png', 150.00, 1),
      ('Gobi Manchurian', 'Snacks', 'Crispy cauliflower florets in a savory garlic sauce.', '1 Plate', 'veg', 'gobi-manchurian.png', 110.00, 1),
      ('Omelette', 'Snacks', 'Double-egg omelette with onions, green chillies, and pepper.', '1 Plate', 'nonveg', 'omelette.png', 45.00, 1),
      ('Veg Puff', 'Snacks', 'Flaky pastry stuffed with seasoned mixed vegetables.', '1 Piece', 'veg', 'veg-puff.png', 30.00, 1),
      ('Egg Puff', 'Snacks', 'Flaky pastry filled with half a boiled egg and spices.', '1 Piece', 'nonveg', 'egg-puff.png', 40.00, 1),
      ('Mixed Veg Sandwich', 'Snacks', 'Fresh sandwich with cucumber, tomato, and green chutney.', '1 Sandwich', 'veg', 'veg-sandwich.png', 70.00, 1),

      -- Beverages & Desserts
      ('Tea', 'Beverages', 'Freshly prepared hot milk tea.', '1 Cup', 'veg', 'tea.png', 25.00, 1),
      ('Coffee', 'Beverages', 'Hot filter coffee.', '1 Cup', 'veg', 'coffee.png', 30.00, 1),
      ('Fresh Fruit Juice', 'Beverages', 'Refreshing seasonal fresh fruit juice (no ice).', '1 Glass', 'veg', 'juice.png', 75.00, 1),
      ('Cut Fruits Bowl', 'Desserts', 'Healthy bowl of fresh seasonal sliced fruits.', '1 Bowl', 'veg', 'cut-fruits.png', 60.00, 1);
    `);

    connection.release();
    console.log('✅ Database fully synchronized with orders schema and menu items.');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
  }
});
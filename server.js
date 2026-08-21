require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const path = require('path');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');

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

// Fallback: send index.html for the root (static middleware already serves other files)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/db-test', async (req, res) => {
  try {
    const pool = require('./config/db');
    const [rows] = await pool.query('SELECT 1 AS connected');

    res.json({
      success: true,
      database: rows[0]
    });
  } catch (err) {
    console.error('DB TEST ERROR:', err);

    res.status(500).json({
      success: false,
      error: err.code,
      message: err.message,
      debug: {
        host: process.env.DB_HOST || "MISSING",
        port: process.env.DB_PORT || "MISSING",
        user: process.env.DB_USER || "MISSING",
        node_env: process.env.NODE_ENV || "MISSING"
      }
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found.' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Hospital Cafe server running at http://localhost:${PORT}`);
});


const pool = require('./config/db');
pool.query("ALTER TABLE orders ADD COLUMN payment_status VARCHAR(50) DEFAULT 'Pending'")
  .then(()=> console.log('✅ Added payment_status'))
  .catch(()=> console.log('⚠️ payment_status already exists'));
pool.query("ALTER TABLE orders ADD COLUMN total_amount DECIMAL(10,2) DEFAULT 0.00")
  .then(()=> console.log('✅ Added total_amount'))
  .catch(()=> console.log('⚠️ total_amount already exists'));

const pool = require('./config/db');
pool.query("ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(100) DEFAULT NULL")
  .then(()=> console.log('✅ Added transaction_id'))
  .catch(()=> console.log('⚠️ transaction_id already exists'));

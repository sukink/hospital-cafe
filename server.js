require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const path = require('path');

const menuRoutes = require('./routes/menu');
const addonRoutes = require('./routes/addons');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const pool = require('./config/db');
const { runMigrations } = require('./database/migrate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/menu', menuRoutes);
app.use('/api/addons', addonRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Hospital Cafe API is running.' });
});

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// QR entry point: print a QR code that points to  https://<your-site>/order
// (optionally /order?room=204 for a per-room QR). Opens the patient ordering flow directly.
app.get('/order', (req, res) => {
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
    await runMigrations(pool);
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
  }
});

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { issueToken, revokeToken, requireAdmin } = require('../config/adminAuth');

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required.' });
  }

  if (password === process.env.ADMIN_PASSWORD) {
    const token = issueToken();
    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false, message: 'Incorrect password. Please try again.' });
});

// POST /api/admin/logout
router.post('/logout', requireAdmin, (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) revokeToken(token);
  res.json({ success: true });
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
      `SELECT * FROM orders WHERE room_number = ? ORDER BY order_time DESC LIMIT 50`,
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
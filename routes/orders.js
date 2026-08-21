const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAdmin } = require('../config/adminAuth');

const VALID_STATUSES = ['Pending', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];
const ROOM_REGEX = /^[A-Za-z0-9\- ]{1,20}$/;

// POST /api/orders - public, patient places an order
// Prices are ALWAYS read from the database. Frontend prices are never trusted.
router.post('/', async (req, res) => {
  // Catch the new payment_status variable from the frontend
  const { roomNumber, items, specialInstructions = '', payment_status } = req.body || {};

  if (!roomNumber || typeof roomNumber !== 'string' || !roomNumber.trim()) {
    return res.status(400).json({ success: false, message: 'Please enter your room number.' });
  }
  if (!ROOM_REGEX.test(roomNumber.trim())) {
    return res.status(400).json({ success: false, message: 'Please enter a valid room number.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Your cart is empty. Please add at least one item.' });
  }
  for (const it of items) {
    if (!it || typeof it.itemId === 'undefined' || !Number.isInteger(Number(it.itemId))) {
      return res.status(400).json({ success: false, message: 'Invalid item in cart.' });
    }
    if (!Number.isInteger(Number(it.quantity)) || Number(it.quantity) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid quantity for an item in your cart.' });
    }
  }
  if (specialInstructions && String(specialInstructions).length > 300) {
    return res.status(400).json({ success: false, message: 'Special instructions are too long.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const itemIds = items.map(it => Number(it.itemId));
    const [menuRows] = await connection.query(
      `SELECT id, name, price, available FROM menu_items WHERE id IN (${itemIds.map(() => '?').join(',')})`,
      itemIds
    );

    const menuMap = new Map(menuRows.map(r => [r.id, r]));
    let total = 0;
    const orderItemsToInsert = [];

    for (const it of items) {
      const menuItem = menuMap.get(Number(it.itemId));
      if (!menuItem) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'One of the items in your cart is no longer available.' });
      }
      if (!menuItem.available) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: `"${menuItem.name}" is currently unavailable.` });
      }
      const quantity = Number(it.quantity);
      const unitPrice = Number(menuItem.price);
      const amount = Math.round(unitPrice * quantity * 100) / 100;
      total += amount;
      orderItemsToInsert.push({ itemId: menuItem.id, name: menuItem.name, unitPrice, quantity, amount });
    }
    total = Math.round(total * 100) / 100;

    // Safety check for payment status
    const statusOfPayment = payment_status || 'Unpaid';

    // Insert order with payment_status included
    const [orderResult] = await connection.query(
      'INSERT INTO orders (room_number, total_amount, special_instructions, status, payment_status) VALUES (?, ?, ?, ?, ?)',
      [roomNumber.trim(), total, specialInstructions ? String(specialInstructions).trim() : '', 'Pending', statusOfPayment]
    );
    const orderId = orderResult.insertId;

    for (const oi of orderItemsToInsert) {
      await connection.query(
        'INSERT INTO order_items (order_id, item_id, item_name, unit_price, quantity, amount) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, oi.itemId, oi.name, oi.unitPrice, oi.quantity, oi.amount]
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      order: {
        id: orderId,
        roomNumber: roomNumber.trim(),
        items: orderItemsToInsert,
        total,
        specialInstructions: specialInstructions || '',
        status: 'Pending',
        payment_status: statusOfPayment
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('POST /api/orders error:', err);
    res.status(500).json({ success: false, message: 'Could not place your order. Please try again.' });
  } finally {
    connection.release();
  }
});

// GET /api/orders - admin, list all orders (optionally filter by status)
router.get('/', requireAdmin, async (req, res) => {
  const { status } = req.query;
  try {
    let query = 'SELECT * FROM orders';
    const params = [];
    if (status && VALID_STATUSES.includes(status)) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY order_time DESC';
    const [orders] = await pool.query(query, params);

    if (orders.length === 0) {
      return res.json({ success: true, orders: [] });
    }

    const orderIds = orders.map(o => o.id);
    const [items] = await pool.query(
      `SELECT * FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')})`,
      orderIds
    );
    const itemsByOrder = new Map();
    for (const item of items) {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    }

    const fullOrders = orders.map(o => ({ ...o, items: itemsByOrder.get(o.id) || [] }));
    res.json({ success: true, orders: fullOrders });
  } catch (err) {
    console.error('GET /api/orders error:', err);
    res.status(500).json({ success: false, message: 'Could not load orders.' });
  }
});

// GET /api/orders/stats/summary - admin, dashboard statistics
router.get('/stats/summary', requireAdmin, async (req, res) => {
  try {
    const [statusCounts] = await pool.query(
      `SELECT status, COUNT(*) AS count FROM orders GROUP BY status`
    );
    const [todayStats] = await pool.query(
      `SELECT COUNT(*) AS todaysOrders, COALESCE(SUM(total_amount), 0) AS todaysRevenue
       FROM orders WHERE DATE(order_time) = CURDATE()`
    );

    const counts = { Pending: 0, Preparing: 0, Ready: 0, Delivered: 0, Cancelled: 0 };
    for (const row of statusCounts) counts[row.status] = row.count;

    res.json({
      success: true,
      stats: {
        pending: counts.Pending,
        preparing: counts.Preparing,
        ready: counts.Ready,
        delivered: counts.Delivered,
        cancelled: counts.Cancelled,
        todaysOrders: todayStats[0].todaysOrders,
        todaysRevenue: Number(todayStats[0].todaysRevenue)
      }
    });
  } catch (err) {
    console.error('GET /api/orders/stats/summary error:', err);
    res.status(500).json({ success: false, message: 'Could not load statistics.' });
  }
});

// GET /api/orders/:id - admin, single order detail
router.get('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [id]);
    res.json({ success: true, order: { ...orders[0], items } });
  } catch (err) {
    console.error('GET /api/orders/:id error:', err);
    res.status(500).json({ success: false, message: 'Could not load the order.' });
  }
});

// PATCH /api/orders/:id - admin, update order status
router.patch('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value.' });
  }
  try {
    const [result] = await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/orders/:id error:', err);
    res.status(500).json({ success: false, message: 'Could not update the order status.' });
  }
});

module.exports = router;
// GET /api/orders/track/:id - Public route for patients to track their order
router.get('/track/:id', async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT status FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    res.json({ success: true, status: orders[0].status });
  } catch (err) {
    console.error('Tracking Error:', err);
    res.status(500).json({ success: false, message: 'Could not track order.' });
  }
});
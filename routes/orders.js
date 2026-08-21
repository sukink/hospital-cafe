const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAdmin } = require('../config/adminAuth');

const VALID_STATUSES = ['Pending', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];
const ROOM_REGEX = /^[A-Za-z0-9\- ]{1,20}$/;

// 1. POST /api/orders - Public, patient places an order
router.post('/', async (req, res) => {
  const { roomNumber, items, specialInstructions = '', payment_status } = req.body || {};

  if (!roomNumber || typeof roomNumber !== 'string' || !roomNumber.trim()) {
    return res.status(400).json({ success: false, message: 'Please enter your room number.' });
  }
  if (!ROOM_REGEX.test(roomNumber.trim())) {
    return res.status(400).json({ success: false, message: 'Please enter a valid room number.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Your cart is empty.' });
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
      if (!menuItem || !menuItem.available) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'An item in your cart is unavailable.' });
      }
      const quantity = Number(it.quantity);
      const unitPrice = Number(menuItem.price);
      const amount = Math.round(unitPrice * quantity * 100) / 100;
      total += amount;
      orderItemsToInsert.push({ itemId: menuItem.id, name: menuItem.name, unitPrice, quantity, amount });
    }
    
    total = Math.round(total * 100) / 100;
    const statusOfPayment = payment_status || 'Unpaid';

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
        status: 'Pending',
        payment_status: statusOfPayment
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('Order Error:', err);
    res.status(500).json({ success: false, message: 'Could not place your order.' });
  } finally {
    connection.release();
  }
});

// 2. GET /api/orders/room/:roomNumber - Public, patients see their history
router.get('/room/:roomNumber', async (req, res) => {
  try {
    const [orders] = await pool.query(
      'SELECT id, total_amount, status, payment_status, DATE_FORMAT(order_time, "%h:%i %p") as time FROM orders WHERE room_number = ? ORDER BY id DESC LIMIT 10',
      [req.params.roomNumber.trim()]
    );
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Room History Error:', err);
    res.status(500).json({ success: false, message: 'Could not load history.' });
  }
});

// 3. GET /api/orders/track/:id - Public, patient live tracking
router.get('/track/:id', async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT status FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).json({ success: false });
    res.json({ success: true, status: orders[0].status });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 4. GET /api/orders - Admin, list all orders
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

    if (orders.length === 0) return res.json({ success: true, orders: [] });

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
    res.status(500).json({ success: false, message: 'Could not load orders.' });
  }
});

// 5. GET /api/orders/stats/summary - Admin, dashboard statistics
router.get('/stats/summary', requireAdmin, async (req, res) => {
  try {
    const [statusCounts] = await pool.query(`SELECT status, COUNT(*) AS count FROM orders GROUP BY status`);
    const [todayStats] = await pool.query(
      `SELECT COUNT(*) AS todaysOrders, COALESCE(SUM(total_amount), 0) AS todaysRevenue FROM orders WHERE DATE(order_time) = CURDATE()`
    );

    const counts = { Pending: 0, Preparing: 0, Ready: 0, Delivered: 0, Cancelled: 0 };
    for (const row of statusCounts) counts[row.status] = row.count;

    res.json({
      success: true,
      stats: {
        ...counts,
        todaysOrders: todayStats[0].todaysOrders,
        todaysRevenue: Number(todayStats[0].todaysRevenue)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load stats.' });
  }
});

// 6. GET /api/orders/:id - Admin, single order detail
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) return res.status(404).json({ success: false });
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
    res.json({ success: true, order: { ...orders[0], items } });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 7. PATCH /api/orders/:id - Admin, update order status
router.patch('/:id', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ success: false });
  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
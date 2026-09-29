const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAdmin } = require('../config/adminAuth');

const VALID_STATUSES = ['New', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Completed', 'Cancelled'];
// Statuses staff can manually set from the dashboard: New orders move to Preparing → Ready →
// Delivered, or can be Cancelled. VALID_STATUSES above stays broad so older orders with other
// in-between statuses can still be found/filtered correctly.
const MANUAL_UPDATE_STATUSES = ['Preparing', 'Ready', 'Delivered', 'Cancelled'];
const ROOM_REGEX = /^[A-Za-z0-9\- ]{1,20}$/;

// Helper: Generate Unique Order Number e.g. ORD-20260821-001
async function generateOrderNumber(connection) {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [rows] = await connection.query(
        `SELECT COUNT(*) as count FROM orders WHERE DATE(order_time) = CURDATE()`
    );
    const seq = (rows[0].count + 1).toString().padStart(3, '0');
    return `ORD-${todayStr}-${seq}`;
}

// Helper: Generate Unique Test Transaction ID e.g. TXN-20260821-8F73K92A
function generateTestTransactionID() {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
    const randomNum = Math.floor(10 + Math.random() * 90);
    return `TXN-${todayStr}-${randomChars}${randomNum}`;
}


// Helper: load order_items (+ their add-on snapshots) for a list of orders.
// Each item gets: addons[], base_amount (base × qty), addons_amount (add-ons × qty), amount (line total).
async function attachItems(orders) {
    if (orders.length === 0) return [];
    const orderIds = orders.map(o => o.id);
    const [items] = await pool.query(
        `SELECT * FROM order_items WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY id`,
        orderIds
    );
    const addonsByItem = new Map();
    if (items.length > 0) {
        const itemIds = items.map(i => i.id);
        const [addonRows] = await pool.query(
            `SELECT order_item_id, addon_id, addon_name, addon_price FROM order_item_addons
             WHERE order_item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY id`,
            itemIds
        );
        for (const a of addonRows) {
            if (!addonsByItem.has(a.order_item_id)) addonsByItem.set(a.order_item_id, []);
            addonsByItem.get(a.order_item_id).push({ id: a.addon_id, name: a.addon_name, price: Number(a.addon_price) });
        }
    }
    const itemsByOrder = new Map();
    for (const item of items) {
        const qty = Number(item.quantity);
        const decorated = {
            ...item,
            addons: addonsByItem.get(item.id) || [],
            base_amount: Math.round(Number(item.unit_price) * qty * 100) / 100,
            addons_amount: Math.round(Number(item.addons_unit_total || 0) * qty * 100) / 100
        };
        if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
        itemsByOrder.get(item.order_id).push(decorated);
    }
    return orders.map(o => ({ ...o, items: itemsByOrder.get(o.id) || [] }));
}

// 1. POST /api/orders - Public, patient places an order
router.post('/', async (req, res) => {
  const { roomNumber, items, specialInstructions = '', payment_method } = req.body || {};

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

    // Validate every cart line before touching the database.
    for (const it of items) {
      const q = Number(it.quantity);
      if (!Number.isInteger(Number(it.itemId)) || !Number.isInteger(q) || q < 1 || q > 50) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Invalid item or quantity in your cart.' });
      }
    }

    const itemIds = [...new Set(items.map(it => Number(it.itemId)))];
    const [menuRows] = await connection.query(
      `SELECT id, name, price, available FROM menu_items WHERE id IN (${itemIds.map(() => '?').join(',')})`,
      itemIds
    );
    const menuMap = new Map(menuRows.map(r => [r.id, r]));

    // Add-ons that belong to each ordered dish AND are currently available.
    // Anything else the client sends is rejected — prices are always taken from the database.
    const [addonRows] = await connection.query(
      `SELECT mia.menu_item_id, a.id, a.name, a.price
       FROM menu_item_addons mia JOIN addons a ON a.id = mia.addon_id
       WHERE a.available = 1 AND mia.menu_item_id IN (${itemIds.map(() => '?').join(',')})`,
      itemIds
    );
    const allowedAddons = new Map(); // "itemId:addonId" -> addon row
    for (const a of addonRows) allowedAddons.set(`${a.menu_item_id}:${a.id}`, a);

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

      const requestedIds = [...new Set((Array.isArray(it.addonIds) ? it.addonIds : []).map(Number))];
      const addons = [];
      for (const addonId of requestedIds) {
        const addon = allowedAddons.get(`${menuItem.id}:${addonId}`);
        if (!addon) {
          await connection.rollback();
          return res.status(400).json({ success: false, message: `An add-on for ${menuItem.name} is no longer available. Please review your cart.` });
        }
        addons.push({ id: addon.id, name: addon.name, price: Number(addon.price) });
      }

      const addonsUnitTotal = Math.round(addons.reduce((sum, a) => sum + a.price, 0) * 100) / 100;
      // (base + selected add-ons) × quantity
      const amount = Math.round((unitPrice + addonsUnitTotal) * quantity * 100) / 100;
      total += amount;
      orderItemsToInsert.push({
        itemId: menuItem.id, name: menuItem.name, unitPrice, quantity, addons, addonsUnitTotal,
        baseAmount: Math.round(unitPrice * quantity * 100) / 100,
        addonsAmount: Math.round(addonsUnitTotal * quantity * 100) / 100,
        amount
      });
    }

    total = Math.round(total * 100) / 100;
    const order_number = await generateOrderNumber(connection);
    const transaction_id = generateTestTransactionID();
    const paymentStatus = 'Successful'; // Test payment success mock

    const [orderResult] = await connection.query(
      `INSERT INTO orders 
       (order_number, transaction_id, room_number, total_amount, payment_method, payment_status, special_instructions, status, order_time, time_placed, time_payment) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'New', NOW(), NOW(), NOW())`,
      [order_number, transaction_id, roomNumber.trim(), total, payment_method || 'Test Payment', paymentStatus, specialInstructions ? String(specialInstructions).trim() : '']
    );

    const orderId = orderResult.insertId;

    for (const oi of orderItemsToInsert) {
      const [itemResult] = await connection.query(
        'INSERT INTO order_items (order_id, item_id, item_name, unit_price, addons_unit_total, quantity, amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, oi.itemId, oi.name, oi.unitPrice, oi.addonsUnitTotal, oi.quantity, oi.amount]
      );
      for (const a of oi.addons) {
        await connection.query(
          'INSERT INTO order_item_addons (order_item_id, addon_id, addon_name, addon_price) VALUES (?, ?, ?, ?)',
          [itemResult.insertId, a.id, a.name, a.price]
        );
      }
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      order: {
        id: orderId,
        order_number,
        transaction_id,
        roomNumber: roomNumber.trim(),
        items: orderItemsToInsert,
        total,
        status: 'New',
        payment_status: paymentStatus
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

// 2. GET /api/orders/room/:roomNumber - Public, patient room history tracking
router.get('/room/:roomNumber', async (req, res) => {
  try {
    const room = req.params.roomNumber.trim();
    const [orders] = await pool.query(
      `SELECT id, order_number, transaction_id, total_amount, status, payment_status, cancellation_reason,
              DATE_FORMAT(order_time, '%h:%i %p') as time 
       FROM orders WHERE room_number = ? ORDER BY id DESC LIMIT 10`,
      [room]
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
    const [orders] = await pool.query('SELECT status, order_number, transaction_id, cancellation_reason FROM orders WHERE id = ? OR order_number = ?', [req.params.id, req.params.id]);
    if (orders.length === 0) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, status: orders[0].status, order: orders[0] });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 4. GET /api/orders/active - Admin, Active Orders (Excludes Delivered, Completed, Cancelled)
router.get('/active', requireAdmin, async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT * FROM orders WHERE status NOT IN ('Delivered', 'Completed', 'Cancelled') ORDER BY order_time DESC`
    );

    const fullOrders = await attachItems(orders);
    res.json({ success: true, orders: fullOrders });
  } catch (err) {
    console.error('Active Orders Error:', err);
    res.status(500).json({ success: false, message: 'Could not load active orders.' });
  }
});

// 5. GET /api/orders/completed - Admin, Archived / Completed Orders with search & filters
router.get('/completed', requireAdmin, async (req, res) => {
  try {
    const { search, status, date } = req.query;
    let query = `SELECT * FROM orders WHERE status IN ('Delivered', 'Completed', 'Cancelled')`;
    let params = [];

    if (search) {
      query += ` AND (id LIKE ? OR order_number LIKE ? OR transaction_id LIKE ? OR room_number LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status && VALID_STATUSES.includes(status)) {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (date) {
      query += ` AND DATE(order_time) = ?`;
      params.push(date);
    }

    query += ` ORDER BY order_time DESC LIMIT 100`;
    const [orders] = await pool.query(query, params);

    const fullOrders = await attachItems(orders);
    res.json({ success: true, orders: fullOrders });
  } catch (err) {
    console.error('Completed Orders Error:', err);
    res.status(500).json({ success: false, message: 'Could not load completed orders.' });
  }
});

// 6. GET /api/orders/stats/summary - Admin, Today's Dashboard summary statistics
router.get('/stats/summary', requireAdmin, async (req, res) => {
  try {
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status IN ('Delivered', 'Completed') THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status IN ('New', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery') THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status IN ('New', 'Accepted') THEN 1 ELSE 0 END) as new_orders,
        SUM(CASE WHEN status = 'Preparing' THEN 1 ELSE 0 END) as preparing_orders,
        SUM(CASE WHEN status = 'Ready' THEN 1 ELSE 0 END) as ready_orders,
        SUM(CASE WHEN status = 'Out for Delivery' THEN 1 ELSE 0 END) as delivery_orders,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(CASE WHEN payment_status = 'Successful' THEN 1 ELSE 0 END) as successful_payments,
        SUM(CASE WHEN payment_status = 'Successful' AND status <> 'Cancelled' THEN total_amount ELSE 0 END) as today_revenue
      FROM orders WHERE DATE(order_time) = CURDATE()
    `);

    res.json({
      success: true,
      stats: summary[0]
    });
  } catch (err) {
    console.error('Stats Error:', err);
    res.status(500).json({ success: false, message: 'Could not load stats.' });
  }
});

// 7. GET /api/orders/:id - Admin, single order detail
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? OR order_number = ?', [req.params.id, req.params.id]);
    if (orders.length === 0) return res.status(404).json({ success: false, message: 'Order not found' });
    const [fullOrder] = await attachItems([orders[0]]);
    res.json({ success: true, order: fullOrder });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 8. PATCH /api/orders/:id/status - Admin, update status with precise timestamp logging & auto-archiving
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { status, cancellation_reason, admin_id = 'Admin' } = req.body || {};
  if (!MANUAL_UPDATE_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status. Allowed: Preparing, Ready, Delivered or Cancelled.' });
  }
  if (status === 'Cancelled' && !String(cancellation_reason || '').trim()) {
    return res.status(400).json({ success: false, message: 'Cancellation reason is required when cancelling an order.' });
  }

  const orderId = req.params.id;
  let timestampField = '';
  if (status === 'Accepted') timestampField = 'time_accepted = NOW()';
  else if (status === 'Preparing') timestampField = 'time_preparing = NOW()';
  else if (status === 'Ready') timestampField = 'time_ready = NOW()';
  else if (status === 'Out for Delivery') timestampField = 'time_out_for_delivery = NOW()';
  else if (status === 'Delivered' || status === 'Completed') timestampField = 'time_delivered = NOW()';

  try {
    let query = `UPDATE orders SET status = ?`;
    let params = [status];

    if (timestampField) {
      query += `, ${timestampField}`;
    }
    if (status === 'Cancelled') {
      query += `, cancellation_reason = ?, cancelled_by = ?`;
      params.push(String(cancellation_reason).trim(), admin_id);
    }
    query += ` WHERE id = ? OR order_number = ?`;
    params.push(orderId, orderId);

    const [updateResult] = await pool.query(query, params);
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // Log admin action
    await pool.query(
      `INSERT INTO admin_activity_logs (admin_id, action, related_item) VALUES (?, ?, ?)`,
      [admin_id, `Updated order status to ${status}`, orderId]
    );

    res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (err) {
    console.error('Status Update Error:', err);
    res.status(500).json({ success: false, message: 'Could not update order status.' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAdmin } = require('../config/adminAuth');

const CATEGORIES = ['Breakfast', 'Main Course', 'Snacks', 'Beverages', 'Dinner', 'Desserts'];
const FOOD_TYPES = ['veg', 'nonveg'];

function isValidMenuInput(body) {
  const { name, category, serving, food_type, price } = body;
  if (!name || typeof name !== 'string' || !name.trim()) return 'Item name is required.';
  if (!CATEGORIES.includes(category)) return 'Invalid category.';
  if (!serving || typeof serving !== 'string' || !serving.trim()) return 'Serving is required.';
  if (!FOOD_TYPES.includes(food_type)) return 'Invalid food type.';
  if (price === undefined || isNaN(price) || Number(price) <= 0) return 'Price must be a positive number.';
  return null;
}

// GET /api/menu - public, patient-facing (safe query)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, category, description, serving, food_type, image, price, available 
       FROM menu_items WHERE available = 1 ORDER BY category, name`
    );
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error('GET /api/menu error:', err);
    res.status(500).json({ success: false, message: 'Could not load the menu. Please try again.' });
  }
});

// GET /api/menu/all - admin, includes disabled items
router.get('/all', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM menu_items ORDER BY category, name');
    res.json({ success: true, items: rows });
  } catch (err) {
    console.error('GET /api/menu/all error:', err);
    res.status(500).json({ success: false, message: 'Could not load the menu.' });
  }
});

// POST /api/menu - admin, add new food item
router.post('/', requireAdmin, async (req, res) => {
  const { name, category, description = '', serving, food_type, image = null, price, available = 1 } = req.body || {};
  const error = isValidMenuInput(req.body || {});
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const [result] = await pool.query(
      `INSERT INTO menu_items (name, category, description, serving, food_type, image, price, available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), category, description, serving.trim(), food_type, image, Number(price), available ? 1 : 0]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('POST /api/menu error:', err);
    res.status(500).json({ success: false, message: 'Could not add the item. Please try again.' });
  }
});

// PUT /api/menu/:id - admin, edit food item
router.put('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, category, description = '', serving, food_type, image = null, price, available = 1 } = req.body || {};
  const error = isValidMenuInput(req.body || {});
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const [result] = await pool.query(
      `UPDATE menu_items SET name = ?, category = ?, description = ?, serving = ?, food_type = ?, image = ?, price = ?, available = ?
       WHERE id = ?`,
      [name.trim(), category, description, serving.trim(), food_type, image, Number(price), available ? 1 : 0, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Item not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/menu/:id error:', err);
    res.status(500).json({ success: false, message: 'Could not update the item. Please try again.' });
  }
});

// PATCH /api/menu/:id/availability - admin, toggle enable/disable
router.patch('/:id/availability', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { available } = req.body || {};
  if (available === undefined) {
    return res.status(400).json({ success: false, message: '"available" is required.' });
  }
  try {
    const [result] = await pool.query('UPDATE menu_items SET available = ? WHERE id = ?', [available ? 1 : 0, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Item not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/menu/:id/availability error:', err);
    res.status(500).json({ success: false, message: 'Could not update availability.' });
  }
});

// DELETE /api/menu/:id - admin, remove item
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM menu_items WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Item not found.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/menu/:id error:', err);
    res.status(500).json({ success: false, message: 'Could not delete the item. Please try again.' });
  }
});

module.exports = router;
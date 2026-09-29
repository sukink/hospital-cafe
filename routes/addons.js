const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAdmin } = require('../config/adminAuth');

// All add-on management is admin-only. Patients receive add-ons through GET /api/menu,
// where each dish carries only its own add-ons.

function validate(body) {
  const { name, price } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return 'Add-on name is required.';
  if (name.trim().length > 100) return 'Add-on name is too long.';
  if (price === undefined || price === null || price === '' || isNaN(price) || Number(price) < 0) {
    return 'Price must be 0 or more.';
  }
  return null;
}

function cleanIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

// Replace the set of dishes an add-on belongs to (runs inside the caller's transaction).
async function setLinks(conn, addonId, itemIds) {
  await conn.query('DELETE FROM menu_item_addons WHERE addon_id = ?', [addonId]);
  if (itemIds.length === 0) return;
  // Only link dishes that really exist (avoids FK errors on stale ids).
  const [valid] = await conn.query(
    `SELECT id FROM menu_items WHERE id IN (${itemIds.map(() => '?').join(',')})`, itemIds
  );
  for (const row of valid) {
    await conn.query('INSERT INTO menu_item_addons (menu_item_id, addon_id) VALUES (?, ?)', [row.id, addonId]);
  }
}

// GET /api/addons — every add-on with the dishes it belongs to
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [addons] = await pool.query('SELECT id, name, price, available, created_at FROM addons ORDER BY name');
    const [links] = await pool.query(
      `SELECT mia.addon_id, m.id AS item_id, m.name AS item_name
       FROM menu_item_addons mia JOIN menu_items m ON m.id = mia.menu_item_id
       ORDER BY m.name`
    );
    const byAddon = new Map();
    for (const l of links) {
      if (!byAddon.has(l.addon_id)) byAddon.set(l.addon_id, []);
      byAddon.get(l.addon_id).push({ id: l.item_id, name: l.item_name });
    }
    res.json({
      success: true,
      addons: addons.map(a => {
        const items = byAddon.get(a.id) || [];
        return { ...a, price: Number(a.price), items, menu_item_ids: items.map(i => i.id) };
      })
    });
  } catch (err) {
    console.error('GET /api/addons error:', err);
    res.status(500).json({ success: false, message: 'Could not load add-ons.' });
  }
});

// POST /api/addons — create { name, price, available, menu_item_ids: [] }
router.post('/', requireAdmin, async (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const { name, price, available = 1, menu_item_ids } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO addons (name, price, available) VALUES (?, ?, ?)',
      [name.trim(), Number(price), available ? 1 : 0]
    );
    await setLinks(conn, result.insertId, cleanIds(menu_item_ids));
    await conn.commit();
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    await conn.rollback();
    console.error('POST /api/addons error:', err);
    res.status(500).json({ success: false, message: 'Could not add the add-on.' });
  } finally {
    conn.release();
  }
});

// PUT /api/addons/:id — edit name, price, availability and the dishes it belongs to
router.put('/:id', requireAdmin, async (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const { name, price, available = 1, menu_item_ids } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'UPDATE addons SET name = ?, price = ?, available = ? WHERE id = ?',
      [name.trim(), Number(price), available ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Add-on not found.' });
    }
    if (Array.isArray(menu_item_ids)) {
      await setLinks(conn, Number(req.params.id), cleanIds(menu_item_ids));
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('PUT /api/addons/:id error:', err);
    res.status(500).json({ success: false, message: 'Could not update the add-on.' });
  } finally {
    conn.release();
  }
});

// PATCH /api/addons/:id/availability — enable / disable
router.patch('/:id/availability', requireAdmin, async (req, res) => {
  const { available } = req.body || {};
  if (available === undefined) {
    return res.status(400).json({ success: false, message: '"available" is required.' });
  }
  try {
    const [result] = await pool.query('UPDATE addons SET available = ? WHERE id = ?', [available ? 1 : 0, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Add-on not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/addons/:id/availability error:', err);
    res.status(500).json({ success: false, message: 'Could not update availability.' });
  }
});

// DELETE /api/addons/:id — remove. Past orders keep their own snapshot of the add-on.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM addons WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Add-on not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/addons/:id error:', err);
    res.status(500).json({ success: false, message: 'Could not delete the add-on.' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
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

module.exports = router;

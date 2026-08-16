const crypto = require('crypto');

// Simple in-memory session store — sufficient for a demo app.
// Token issued on successful admin login, required on admin-only routes.
const activeTokens = new Set();

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  activeTokens.add(token);
  return token;
}

function revokeToken(token) {
  activeTokens.delete(token);
}

function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ success: false, message: 'Not authorized. Please log in as admin.' });
  }
  next();
}

module.exports = { issueToken, revokeToken, requireAdmin };

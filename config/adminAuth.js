const crypto = require('crypto');

// In-memory session store — token -> logged-in staff user info.
// Now stores the user record (not just a bare token) so routes can check
// req.staffUser.is_super for account-management permissions.
const activeTokens = new Map();

function issueToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  activeTokens.set(token, user);
  return token;
}

function revokeToken(token) {
  activeTokens.delete(token);
}

function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const user = token ? activeTokens.get(token) : null;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authorized. Please log in as admin.' });
  }
  req.staffUser = user;
  req.staffToken = token;
  next();
}

// Only accounts marked is_super can create/enable/disable/delete other IDs.
function requireSuperAdmin(req, res, next) {
  if (!req.staffUser || !req.staffUser.is_super) {
    return res.status(403).json({ success: false, message: 'Only a super admin account can manage staff accounts.' });
  }
  next();
}

module.exports = { issueToken, revokeToken, requireAdmin, requireSuperAdmin };

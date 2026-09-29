const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const checkBuf = Buffer.from(check, 'hex');
    if (hashBuf.length !== checkBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, checkBuf);
  } catch (err) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };

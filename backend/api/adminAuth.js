const crypto = require('crypto');

// Hardcoded admin credentials (testing only)
const ADMIN_USER = 'clawax';
const ADMIN_PASS = 'sod2026';

// Active tokens (in-memory)
const activeTokens = new Map();

function login(username, password) {
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return { success: false, error: 'Invalid credentials' };
  }
  const token = crypto.randomBytes(32).toString('hex');
  activeTokens.set(token, { createdAt: Date.now(), username: username });
  return { success: true, token: token, message: 'Admin authenticated' };
}

function verifyToken(token) {
  return activeTokens.has(token);
}

function adminGate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Admin token required. POST /api/admin/login first.' });
  }
  const token = auth.slice(7);
  if (!verifyToken(token)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid or expired admin token.' });
  }
  next();
}

module.exports = { login, verifyToken, adminGate };

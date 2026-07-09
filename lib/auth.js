// lib/auth.js — session tokens (signed, no JWT lib) + password hashing (scrypt).
// Shared by every api/*.js handler and the runner agent's login call. Built-in crypto only.
const crypto = require('crypto');

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
function b64urlToBuf(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

// ── Sessions ─────────────────────────────────────────────────────────────────
function sign(payload) {
  const secret = process.env.SESSION_SECRET || '';
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  return p + '.' + sig;
}
function issue(email) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ email: email, iat: now, exp: now + 8 * 3600 });   // 8-hour session
}
function verify(token) {
  try {
    const secret = process.env.SESSION_SECRET || '';
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const expected = b64url(crypto.createHmac('sha256', secret).update(parts[0]).digest());
    const a = Buffer.from(parts[1]); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(b64urlToBuf(parts[0]).toString('utf8'));
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}
function bearer(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  if (h.indexOf('Bearer ') === 0) return h.slice(7);
  return req.headers['x-session'] || '';
}

// ── Passwords (scrypt) ───────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPassword(password, saltHex, hashHex) {
  try {
    const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
    const stored = Buffer.from(hashHex, 'hex');
    return hash.length === stored.length && crypto.timingSafeEqual(hash, stored);
  } catch (e) { return false; }
}

module.exports = { issue, verify, bearer, hashPassword, verifyPassword };

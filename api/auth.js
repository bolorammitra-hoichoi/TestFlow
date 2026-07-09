// api/auth.js — login (shared default password on first use, then personal),
// set/change password, and session verify. Used by both the browser dashboard
// and the runner agent (agent logs in once, caches the returned token).
// Users are stored in Firestore `users` (doc id = lowercased @hoichoi.tv email);
// passwords are scrypt-hashed, never plaintext.
const { admin, db } = require('../lib/firebase');
const auth = require('../lib/auth');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
const EMAIL_RE = /^[^@\s]+@hoichoi\.tv$/;

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const action = body.action;

  try {
    // ── login ────────────────────────────────────────────────────────────────
    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Use your @hoichoi.tv email address.' });
      if (!password) return res.status(400).json({ error: 'Password is required.' });

      const ref = db.collection('users').doc(email);
      const snap = await ref.get();
      const user = snap.exists ? snap.data() : null;

      // Personal password set → verify against it.
      if (user && user.passwordHash) {
        if (!auth.verifyPassword(password, user.salt, user.passwordHash)) return res.status(401).json({ error: 'Incorrect password.' });
        return res.status(200).json({ ok: true, token: auth.issue(email), email: email, mustChange: !!user.mustChange });
      }

      // No personal password yet → must use the shared default, then set one.
      if (password !== (process.env.DEFAULT_PASSWORD || ' ')) return res.status(401).json({ error: 'Incorrect password.' });
      if (!user) await ref.set({ email: email, mustChange: true, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return res.status(200).json({ ok: true, token: auth.issue(email), email: email, mustChange: true });
    }

    // ── set / change password (requires a valid session) ──────────────────────
    if (action === 'set-password') {
      const payload = auth.verify(auth.bearer(req));
      if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      if (newPassword === (process.env.DEFAULT_PASSWORD || '')) return res.status(400).json({ error: 'Choose a password different from the shared default.' });
      const { salt, hash } = auth.hashPassword(newPassword);
      await db.collection('users').doc(payload.email).set({
        passwordHash: hash, salt: salt, mustChange: false, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.status(200).json({ ok: true, token: auth.issue(payload.email), email: payload.email, mustChange: false });
    }

    // ── verify a session token ─────────────────────────────────────────────────
    if (action === 'verify') {
      const payload = auth.verify(auth.bearer(req));
      if (!payload) return res.status(401).json({ error: 'invalid' });
      return res.status(200).json({ ok: true, email: payload.email });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[auth]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

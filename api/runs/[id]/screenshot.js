// api/runs/[id]/screenshot.js — agent uploads one screenshot as base64 JSON
// (simpler than multipart parsing in a Vercel function); forwarded to Firebase
// Storage via the Admin SDK, which the agent never has direct credentials for.
// FLAG-prefixed names (per QAForge's content-dependent-element convention) are
// marked `flagged: true` so the dashboard can surface them as warnings, not failures.
const { bucket } = require('../../../lib/firebase');
const auth = require('../../../lib/auth');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = auth.verify(auth.bearer(req));
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });

  const runId = req.query.id;

  try {
    const body = req.body || {};
    const tcId = String(body.tcId || '');
    const name = String(body.name || '');
    const dataBase64 = String(body.dataBase64 || '');
    if (!tcId || !name || !dataBase64) return res.status(400).json({ error: 'tcId, name, and dataBase64 are required.' });

    const flagged = /^FLAG-/i.test(name);
    const path = `runs/${runId}/${tcId}/${name}.png`;
    const file = bucket.file(path);
    await file.save(Buffer.from(dataBase64, 'base64'), { contentType: 'image/png' });
    await file.makePublic();
    const url = `https://storage.googleapis.com/${bucket.name}/${path}`;

    return res.status(200).json({ ok: true, url, flagged });
  } catch (err) {
    console.error('[runs/id/screenshot]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

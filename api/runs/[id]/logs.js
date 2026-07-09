// api/runs/[id]/logs.js — POST batches of Maestro stdout lines (agent, ~1s
// batches), GET polls for new lines since a cursor (dashboard, ~2s while running).
const { admin, db } = require('../../../lib/firebase');
const auth = require('../../../lib/auth');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const payload = auth.verify(auth.bearer(req));
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });

  const runId = req.query.id;
  const logsRef = db.collection('runs').doc(runId).collection('logs');

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      const tcId = String(body.tcId || '');
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) return res.status(200).json({ ok: true, written: 0 });

      const batch = db.batch();
      for (const line of lines) {
        batch.set(logsRef.doc(), {
          tcId, line: String(line.line || ''),
          ts: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      return res.status(200).json({ ok: true, written: lines.length });
    }

    if (req.method === 'GET') {
      let q = logsRef.orderBy('ts', 'asc');
      const after = req.query.after;
      if (after) q = q.where('ts', '>', new Date(Number(after)));
      const snap = await q.limit(500).get();
      const lines = snap.docs.map((d) => {
        const data = d.data();
        return { tcId: data.tcId, line: data.line, ts: data.ts ? data.ts.toMillis() : Date.now() };
      });
      return res.status(200).json({ ok: true, lines });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[runs/id/logs]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

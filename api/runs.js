// api/runs.js — POST creates a run request (dashboard), GET lists run history.
//
// A run's lifecycle lives entirely on the `runs/{id}` doc's `status` field:
// queued -> claimed -> running -> passed|failed|partial
// (queued->claimed happens in api/agents.js's heartbeat; running->done happens
// in api/runs/[id].js, PATCHed by the agent.)
const { admin, db } = require('../lib/firebase');
const auth = require('../lib/auth');

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

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      const agentId = String(body.agentId || '');
      const app = String(body.app || '');
      const platform = String(body.platform || '');
      const version = String(body.version || '');
      const tcIds = Array.isArray(body.tcIds) ? body.tcIds : []; // empty = full suite
      if (!agentId || !app || !platform || !version) {
        return res.status(400).json({ error: 'agentId, app, platform, and version are required.' });
      }

      const ref = await db.collection('runs').add({
        agentId, app, platform, version, tcIds,
        requestedByEmail: payload.email,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'queued',
      });
      return res.status(200).json({ ok: true, runId: ref.id });
    }

    if (req.method === 'GET') {
      const { app, platform, status, limit } = req.query || {};
      let q = db.collection('runs').orderBy('requestedAt', 'desc');
      if (app) q = q.where('app', '==', app);
      if (platform) q = q.where('platform', '==', platform);
      if (status) q = q.where('status', '==', status);
      q = q.limit(Math.min(parseInt(limit, 10) || 50, 200));

      const snap = await q.get();
      const runs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ ok: true, runs });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[runs]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

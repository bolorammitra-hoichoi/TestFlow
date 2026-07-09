// api/agents.js — runner-agent heartbeat + dashboard's live agent/device list.
//
// POST (agent): reports connected devices (adb devices) and the flows manifest
// it scanned from its local git checkout. If a `runs` doc is queued for this
// agent, claims it (status -> 'claimed') and returns it so the agent can start.
// GET (dashboard): lists all agents so the Run Test picker can show live devices.
//
// agentId is derived from (tester email + hostname) so the same laptop always
// maps to the same agent doc across restarts, without needing a persisted id file.
const crypto = require('crypto');
const { admin, db } = require('../lib/firebase');
const auth = require('../lib/auth');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function agentIdFor(email, hostname) {
  return crypto.createHash('sha256').update(`${email}::${hostname}`).digest('hex').slice(0, 24);
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const payload = auth.verify(auth.bearer(req));
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });

  try {
    if (req.method === 'GET') {
      const snap = await db.collection('agents').get();
      const agents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ ok: true, agents });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const hostname = String(body.hostname || 'unknown-host');
      const os = String(body.os || '');
      const connectedDevices = Array.isArray(body.connectedDevices) ? body.connectedDevices : [];
      const manifest = Array.isArray(body.manifest) ? body.manifest : [];

      const agentId = agentIdFor(payload.email, hostname);
      const ref = db.collection('agents').doc(agentId);
      await ref.set({
        ownerEmail: payload.email,
        hostname, os, connectedDevices, manifest,
        lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Only try to claim a new run if the agent reports itself idle — an agent
      // mid-run keeps heartbeating (so it doesn't look offline) but must not be
      // handed a second run on top of the one it's already executing.
      let claimedRun = null;
      if (body.idle === true) {
        const queuedSnap = await db.collection('runs')
          .where('agentId', '==', agentId)
          .where('status', '==', 'queued')
          .orderBy('requestedAt', 'asc')
          .limit(1)
          .get();

        if (!queuedSnap.empty) {
          const runDoc = queuedSnap.docs[0];
          await runDoc.ref.update({ status: 'claimed', claimedAt: admin.firestore.FieldValue.serverTimestamp() });
          claimedRun = { id: runDoc.id, ...runDoc.data(), status: 'claimed' };
        }
      }

      return res.status(200).json({ ok: true, agentId, claimedRun });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[agents]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

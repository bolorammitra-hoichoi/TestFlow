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

// Well above the longest real silent wait already in the flows themselves
// (TC-01 has a 9-minute extendedWaitUntil) — a genuinely slow-but-alive run
// must never be falsely swept as stuck.
const STALE_MS = 15 * 60 * 1000;
const SWEEP_MIN_INTERVAL_MS = 60 * 1000;

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  return 0;
}

// Backstop for "the agent that owns a stuck run never comes back." Rate-limited
// via a single meta/sweep doc so this isn't a collection scan on every one of
// every agent's heartbeats. Deliberately avoids any Firestore range/inequality
// query (that needs a manual composite index — already painful once this
// project) by fetching claimed/running runs with plain equality queries and
// checking staleness in memory; the number of concurrently in-flight runs for
// an internal tool is always small enough for this to be cheap.
async function maybeSweepStaleRuns() {
  const sweepRef = db.collection('meta').doc('sweep');
  const sweepSnap = await sweepRef.get();
  const lastSweptMs = sweepSnap.exists ? toMillis(sweepSnap.data().lastSweptAt) : 0;
  if (Date.now() - lastSweptMs < SWEEP_MIN_INTERVAL_MS) return;
  await sweepRef.set({ lastSweptAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const now = Date.now();
  for (const status of ['claimed', 'running']) {
    const snap = await db.collection('runs').where('status', '==', status).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const lastContact = toMillis(data.lastContactAt) || toMillis(data.requestedAt);
      if (lastContact && now - lastContact > STALE_MS) {
        await doc.ref.update({
          status: 'cancelled',
          failureReason: 'stale_timeout',
          finishedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastContactAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }
}

// Self-heal: an agent reporting idle=true but with a run of its own still
// stuck in claimed/running has provably orphaned it — a truly in-progress
// run would coincide with idle=false from that same process (busy=true).
// This covers the case that just happened: the agent process died mid-run
// and only comes back to life later, idle, with no memory of the old run.
async function healOwnOrphans(agentId) {
  for (const status of ['claimed', 'running']) {
    const snap = await db.collection('runs')
      .where('agentId', '==', agentId)
      .where('status', '==', status)
      .get();
    for (const doc of snap.docs) {
      await doc.ref.update({
        status: 'cancelled',
        failureReason: 'agent_restarted',
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastContactAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const payload = auth.verify(auth.bearer(req));
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });

  try {
    if (req.method === 'GET') {
      const snap = await db.collection('agents').get();
      // Compute heartbeat age HERE, on the server clock, and hand the browser a
      // ready-made age. Testers' laptop clocks can be wildly off (observed ~50s
      // skew), so the dashboard must NOT compute `browserNow - serverTimestamp`
      // itself — that makes a healthy agent look offline. Both this Date.now()
      // (Vercel) and lastHeartbeatAt (Firestore serverTimestamp) are NTP-synced
      // server clocks, so their difference is accurate well within our window.
      const nowMs = Date.now();
      const agents = snap.docs.map((d) => {
        const data = d.data();
        const hbMs = data.lastHeartbeatAt && typeof data.lastHeartbeatAt.toMillis === 'function'
          ? data.lastHeartbeatAt.toMillis() : 0;
        return { id: d.id, ...data, lastHeartbeatAgeMs: hbMs ? (nowMs - hbMs) : null };
      });
      return res.status(200).json({ ok: true, agents });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const hostname = String(body.hostname || 'unknown-host');
      const os = String(body.os || '');
      const connectedDevices = Array.isArray(body.connectedDevices) ? body.connectedDevices : [];
      const manifest = Array.isArray(body.manifest) ? body.manifest : [];
      const currentRunId = body.currentRunId || null;

      const agentId = agentIdFor(payload.email, hostname);
      const ref = db.collection('agents').doc(agentId);
      await ref.set({
        ownerEmail: payload.email,
        hostname, os, connectedDevices, manifest,
        lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await maybeSweepStaleRuns();

      // If the agent told us which run it's currently executing, let it know
      // whether a Cancel has been requested — this is the ~10s backstop for
      // cancel detection, on top of the tighter ~1s check on the log endpoint.
      let cancelRequested = false;
      if (currentRunId) {
        const runSnap = await db.collection('runs').doc(currentRunId).get();
        if (runSnap.exists) cancelRequested = !!runSnap.data().cancelRequested;
      }

      // Only try to claim a new run if the agent reports itself idle — an agent
      // mid-run keeps heartbeating (so it doesn't look offline) but must not be
      // handed a second run on top of the one it's already executing.
      let claimedRun = null;
      if (body.idle === true) {
        await healOwnOrphans(agentId);

        const queuedSnap = await db.collection('runs')
          .where('agentId', '==', agentId)
          .where('status', '==', 'queued')
          .orderBy('requestedAt', 'asc')
          .limit(1)
          .get();

        if (!queuedSnap.empty) {
          const runDoc = queuedSnap.docs[0];
          await runDoc.ref.update({
            status: 'claimed',
            claimedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastContactAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          claimedRun = { id: runDoc.id, ...runDoc.data(), status: 'claimed' };
        }
      }

      return res.status(200).json({ ok: true, agentId, claimedRun, cancelRequested });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[agents]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

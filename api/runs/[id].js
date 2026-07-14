// api/runs/[id].js — GET a run's full detail (dashboard Run Detail page),
// PATCH transitions it forward (agent: start/tc-update/complete; anyone: cancel).
//
// Every mutating action runs inside a Firestore transaction that checks the
// run isn't already terminal before writing. Without this, a late update from
// a dying/zombie agent process can race a user's Cancel and silently revive
// a run that should have stayed cancelled.
const { admin, db } = require('../../lib/firebase');
const auth = require('../../lib/auth');

const TERMINAL_STATUSES = ['passed', 'failed', 'cancelled'];
function isTerminal(status) { return TERMINAL_STATUSES.includes(status); }

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const payload = auth.verify(auth.bearer(req));
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });

  const id = req.query.id;
  const ref = db.collection('runs').doc(id);

  try {
    if (req.method === 'GET') {
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Run not found.' });
      const tcSnap = await ref.collection('tcResults').get();
      const tcResults = tcSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ ok: true, run: { id: snap.id, ...snap.data() }, tcResults });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const action = body.action;

      // Agent confirms it has started executing a claimed run.
      if (action === 'start') {
        await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          if (!snap.exists) throw new Error('Run not found.');
          if (isTerminal(snap.data().status)) return;
          t.update(ref, {
            status: 'running',
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastContactAt: admin.firestore.FieldValue.serverTimestamp(),
            buildNumber: body.buildNumber || null,
            device: body.device || null,
            totalTcs: body.totalTcs || 0,
            tcSummary: [],
          });
        });
        return res.status(200).json({ ok: true });
      }

      // Agent reports one TC starting or finishing, so the dashboard can show
      // real per-TC progress during a run instead of only at the very end.
      // Superseded by the full tcResults doc once 'complete' runs.
      if (action === 'tc-update') {
        const { tcId, name, status } = body;
        if (!tcId) return res.status(400).json({ error: 'tcId is required.' });

        await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          if (!snap.exists) throw new Error('Run not found.');
          const data = snap.data();
          if (isTerminal(data.status)) return;

          const tcRef = ref.collection('tcResults').doc(tcId);
          const tcSummary = Array.isArray(data.tcSummary) ? data.tcSummary.slice() : [];
          const idx = tcSummary.findIndex((tc) => tc.tcId === tcId);
          const entry = { tcId, name, status, flagCount: 0 };
          if (idx === -1) tcSummary.push(entry); else tcSummary[idx] = entry;

          t.set(tcRef, { name, status }, { merge: true });
          t.update(ref, { tcSummary, lastContactAt: admin.firestore.FieldValue.serverTimestamp() });
        });
        return res.status(200).json({ ok: true });
      }

      // Agent posts the final result — per-TC docs + a rolled-up summary/status.
      if (action === 'complete') {
        const overallStatus = await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          if (!snap.exists) throw new Error('Run not found.');
          if (isTerminal(snap.data().status)) return snap.data().status;

          const tcResults = Array.isArray(body.tcResults) ? body.tcResults : [];
          const tcSummary = [];
          for (const tc of tcResults) {
            const tcRef = ref.collection('tcResults').doc(tc.tcId);
            t.set(tcRef, tc);
            // v1 has no Storage — tc.screenshots holds {name, flagged} only,
            // pointing at files that stay on the tester's own machine.
            tcSummary.push({
              tcId: tc.tcId, name: tc.name, status: tc.status,
              flagCount: Array.isArray(tc.screenshots) ? tc.screenshots.filter((s) => s.flagged).length : 0,
            });
          }
          const status = tcSummary.some((tc) => tc.status === 'failed') ? 'failed' : 'passed';
          t.update(ref, {
            status,
            tcSummary,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastContactAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return status;
        });
        return res.status(200).json({ ok: true, status: overallStatus });
      }

      // Any signed-in user can cancel a run — a tester should be able to
      // resolve their own stuck run even if the owning agent is long dead.
      if (action === 'cancel') {
        const result = await db.runTransaction(async (t) => {
          const snap = await t.get(ref);
          if (!snap.exists) return { notFound: true };
          const data = snap.data();
          if (isTerminal(data.status)) return { alreadyTerminal: true, status: data.status };
          t.update(ref, {
            status: 'cancelled',
            cancelRequested: true,
            failureReason: 'user_cancelled',
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastContactAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return { ok: true, status: 'cancelled' };
        });
        if (result.notFound) return res.status(404).json({ error: 'Run not found.' });
        return res.status(200).json({ ok: true, status: result.status, alreadyTerminal: !!result.alreadyTerminal });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[runs/id]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

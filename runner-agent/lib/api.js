// lib/api.js — thin HTTP client for the TestFlow backend. The agent never
// talks to Firebase directly; every write goes through these authenticated
// calls, same trust model as the browser dashboard.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SESSION_PATH = path.join(os.homedir(), '.testflow', 'session.json');
let token = null;

function loadCachedSession() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    if (raw && raw.token) token = raw.token;
  } catch (e) { /* no cached session yet */ }
}

function cacheSession(t) {
  token = t;
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify({ token: t }), 'utf8');
}

function baseUrl() {
  const url = process.env.TESTFLOW_API_URL;
  if (!url) throw new Error('TESTFLOW_API_URL is not set — copy .env.example to .env and fill it in.');
  return url.replace(/\/+$/, '');
}

async function call(pathname, { method = 'GET', body, auth = true, _retried = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    if (!token) throw new Error('Not logged in yet.');
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl()}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Sessions expire after 8h. The agent runs unattended for days, so on a 401
  // it must transparently log back in (it has creds in .env) and retry — ONCE —
  // instead of silently becoming a zombie that keeps failing every heartbeat
  // and serving the server its last pre-expiry state forever. login() itself
  // calls with auth:false, so it can never recurse into this branch.
  if (res.status === 401 && auth && !_retried) {
    console.warn('[testflow] session expired — re-authenticating…');
    await login();
    return call(pathname, { method, body, auth, _retried: true });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${pathname} failed (${res.status})`);
  return data;
}

async function login() {
  loadCachedSession();
  const email = process.env.TESTFLOW_EMAIL;
  const password = process.env.TESTFLOW_PASSWORD;
  if (!email || !password) throw new Error('TESTFLOW_EMAIL / TESTFLOW_PASSWORD are not set in .env');

  const data = await call('/api/auth', { method: 'POST', auth: false, body: { action: 'login', email, password } });
  cacheSession(data.token);
  if (data.mustChange) {
    console.warn('[testflow] Using the shared default password — set a personal one from the dashboard soon.');
  }
  return data;
}

async function heartbeat(payload) {
  return call('/api/agents', { method: 'POST', body: payload });
}

async function startRun(runId, body) {
  return call(`/api/runs/${runId}`, { method: 'PATCH', body: { action: 'start', ...body } });
}

async function tcUpdate(runId, tcId, name, status) {
  return call(`/api/runs/${runId}`, { method: 'PATCH', body: { action: 'tc-update', tcId, name, status } });
}

async function completeRun(runId, tcResults) {
  return call(`/api/runs/${runId}`, { method: 'PATCH', body: { action: 'complete', tcResults } });
}

// Called unconditionally roughly every 1s during execution, even with an
// empty batch — this is the tight side of cancel detection, and it's also
// what keeps the run's lastContactAt fresh through a long silent Maestro
// wait (real waits up to 9 minutes exist in these flows already).
async function postLogs(runId, tcId, lines) {
  return call(`/api/runs/${runId}/logs`, { method: 'POST', body: { tcId, lines } });
}

module.exports = { login, heartbeat, startRun, tcUpdate, completeRun, postLogs };

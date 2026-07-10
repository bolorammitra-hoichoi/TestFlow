// agent.js — TestFlow runner agent. Run this on your own PC/Mac, alongside
// Maestro CLI + ADB already installed, next to a phone connected over USB.
// It never holds a Firebase key — every write is an authenticated HTTP call
// to the TestFlow API, same as the browser dashboard. See README.md.
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { loadEnv } = require('./lib/env');
loadEnv();

const api = require('./lib/api');
const adb = require('./lib/adb');
const manifest = require('./lib/manifest');
const maestro = require('./lib/maestro');

// Fill in real package ids as they're confirmed; unmapped app/platform pairs
// just skip the automatic build-number lookup and log null instead of failing.
const APP_PACKAGE_IDS = {
  hoichoi: { android: 'com.viewlift.hoichoi', ios: null },
  sooper: { android: null, ios: null },
};

const REPO_DIR = process.env.TESTFLOW_REPO_DIR;
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 10000);

let busy = false;

function gitPull() {
  if (!REPO_DIR) return;
  try {
    execSync('git pull --ff-only', { cwd: REPO_DIR, stdio: 'ignore' });
  } catch (e) {
    console.warn('[testflow] git pull failed — running with whatever is on disk:', e.message);
  }
}

async function tick() {
  gitPull();
  const connectedDevices = adb.listDevices();
  const scannedManifest = manifest.scan(REPO_DIR);

  let claimedRun = null;
  try {
    const res = await api.heartbeat({
      hostname: os.hostname(),
      os: process.platform,
      connectedDevices,
      manifest: scannedManifest,
      idle: !busy,
    });
    claimedRun = res.claimedRun;
  } catch (e) {
    console.error('[testflow] heartbeat failed:', e.message);
    return;
  }

  if (claimedRun && !busy) {
    busy = true;
    executeRun(claimedRun, connectedDevices).catch((e) => {
      console.error('[testflow] run execution crashed:', e.message);
    }).finally(() => { busy = false; });
  }
}

async function executeRun(run, connectedDevices) {
  const device = connectedDevices.find((d) => d.platform === run.platform) || null;
  const packageId = (APP_PACKAGE_IDS[run.app] || {})[run.platform] || null;
  const buildNumber = device && run.platform === 'android' ? adb.versionName(device.serial, packageId) : null;

  const appManifest = manifest.scan(REPO_DIR).find(
    (m) => m.app === run.app && m.platform === run.platform && m.version === run.version
  );
  const tcIds = run.tcIds && run.tcIds.length ? run.tcIds : (appManifest ? appManifest.tcIds : []);

  console.log(`[testflow] starting run ${run.id}: ${run.app}/${run.platform}/${run.version}`);
  await api.startRun(run.id, { buildNumber, device, totalTcs: tcIds.length });

  const tcResults = [];
  for (const tcId of tcIds) {
    const flowPath = manifest.resolveFlow(REPO_DIR, run.app, run.platform, run.version, tcId);
    const screenshotDir = path.join(os.tmpdir(), 'testflow', run.id, tcId);
    await api.tcUpdate(run.id, tcId, tcId, 'running').catch((e) => console.error('[testflow] tc-update (running) failed:', e.message));

    let logBuffer = [];
    const flushLogs = () => {
      if (!logBuffer.length) return;
      const toSend = logBuffer.map((line) => ({ line }));
      logBuffer = [];
      api.postLogs(run.id, tcId, toSend).catch((e) => console.error('[testflow] log flush failed:', e.message));
    };
    const flushInterval = setInterval(flushLogs, 1000);

    const startedAt = Date.now();
    const result = await maestro.runFlow(flowPath, {
      serial: device ? device.serial : undefined,
      screenshotDir,
      onLine: (line) => { console.log(`[${tcId}] ${line}`); logBuffer.push(line); },
    });
    clearInterval(flushInterval);
    flushLogs();

    // No Firebase Storage in v1 (see PROJECT.md) — screenshots stay on this
    // machine. Just record which ones exist and which are FLAG-prefixed, plus
    // the local path, so the dashboard can list them even without hosting them.
    const screenshots = result.screenshotPaths.map((shotPath) => {
      const name = path.basename(shotPath, '.png');
      return { name, localPath: shotPath, flagged: /^FLAG-/i.test(name) };
    });

    tcResults.push({
      tcId, name: tcId, status: result.status,
      startedAt, finishedAt: Date.now(),
      errorMessage: result.errorMessage, screenshots,
    });
    await api.tcUpdate(run.id, tcId, tcId, result.status).catch((e) => console.error('[testflow] tc-update (done) failed:', e.message));
    console.log(`[testflow] ${tcId}: ${result.status}`);
  }

  await api.completeRun(run.id, tcResults);
  console.log(`[testflow] run ${run.id} complete`);
}

async function main() {
  if (!REPO_DIR) throw new Error('TESTFLOW_REPO_DIR is not set — copy .env.example to .env and fill it in.');
  await api.login();
  console.log('[testflow] logged in, starting heartbeat loop');
  await tick();
  setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

main().catch((e) => {
  console.error('[testflow] fatal:', e.message);
  process.exit(1);
});

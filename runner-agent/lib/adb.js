// lib/adb.js — Android device detection + build/version lookup over ADB.
// iOS (idb/simctl) is intentionally not implemented yet — see PROJECT.md,
// it needs a Mac and is materially more work than a bolt-on.
const { execFileSync } = require('child_process');

function run(args) {
  try {
    return execFileSync('adb', args, { encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

function listDevices() {
  const out = run(['devices', '-l']);
  const devices = [];
  for (const line of out.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('device ')) continue;
    const serial = trimmed.split(/\s+/)[0];
    const modelMatch = trimmed.match(/model:(\S+)/);
    devices.push({
      serial,
      model: modelMatch ? modelMatch[1] : 'unknown',
      platform: 'android',
    });
  }
  return devices;
}

function versionName(serial, packageId) {
  if (!packageId) return null;
  const out = run(['-s', serial, 'shell', 'dumpsys', 'package', packageId]);
  const match = out.match(/versionName=(\S+)/);
  return match ? match[1] : null;
}

module.exports = { listDevices, versionName };

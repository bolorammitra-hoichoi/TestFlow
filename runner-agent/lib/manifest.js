// lib/manifest.js — scans the local flows/ checkout and reports what's on
// disk, so the dashboard's app/platform/version/TC pickers always reflect
// reality with no separate "upload your YAMLs" feature to keep in sync.
const fs = require('fs');
const path = require('path');

function scan(repoDir) {
  const flowsDir = path.join(repoDir, 'flows');
  const manifest = [];
  if (!fs.existsSync(flowsDir)) return manifest;

  for (const app of fs.readdirSync(flowsDir)) {
    const appDir = path.join(flowsDir, app);
    if (!fs.statSync(appDir).isDirectory()) continue;

    for (const platform of fs.readdirSync(appDir)) {
      const platformDir = path.join(appDir, platform);
      if (!fs.statSync(platformDir).isDirectory()) continue;

      for (const version of fs.readdirSync(platformDir)) {
        const versionDir = path.join(platformDir, version);
        if (!fs.statSync(versionDir).isDirectory()) continue;

        const tcIds = fs.readdirSync(versionDir)
          .filter((f) => /^TC-\d+.*\.yaml$/i.test(f))
          .map((f) => f.replace(/\.yaml$/i, ''))
          .sort();

        if (tcIds.length) manifest.push({ app, platform, version, tcIds });
      }
    }
  }
  return manifest;
}

function resolveFlow(repoDir, app, platform, version, tcId) {
  return path.join(repoDir, 'flows', app, platform, version, `${tcId}.yaml`);
}

module.exports = { scan, resolveFlow };

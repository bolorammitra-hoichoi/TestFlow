// api/flows.js — read the Maestro flow catalog (and individual flow YAML)
// straight from the GitHub repo. This gives the website a read-only window onto
// the flows WITHOUT depending on a runner agent being online: GitHub is the
// source of truth, and this endpoint lets the dashboard list what test suites
// exist and show their steps regardless of whether any agent is connected.
//
//   GET /api/flows            -> { flows: [{ app, platform, version, files:[{tcId,path,isStartup}] }] }
//   GET /api/flows?path=...   -> { content: "<raw yaml>" }   (path must be flows/**/*.yaml)
//
// Env: GITHUB_TOKEN (a read-only fine-grained PAT with Contents:read on the
// repo — required), GITHUB_REPO ("owner/name", defaults to this project's repo),
// GITHUB_BRANCH (optional, defaults to "main").
//
// The agent still keeps its own local clone to actually RUN Maestro (Maestro
// executes files from disk); this endpoint is purely the website's view.
const auth = require('../lib/auth');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

const REPO = process.env.GITHUB_REPO || 'bolorammitra-hoichoi/TestFlow';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

function ghHeaders(accept) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var is not set');
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'TestFlow',
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: accept,
  };
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = auth.verify(auth.bearer(req));
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });

  try {
    // ── POST: commit a new test case to GitHub ──────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};
      const app = String(body.app || '').trim();
      const platform = String(body.platform || '').trim();
      const version = String(body.version || '').trim();
      const name = String(body.name || '').trim();
      const content = String(body.content || '');

      // folder-name safety: no slashes, no "..", conservative charset
      const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
      if (!SAFE.test(app) || app.includes('..')) return res.status(400).json({ error: 'Invalid app name.' });
      if (!SAFE.test(platform) || platform.includes('..')) return res.status(400).json({ error: 'Invalid platform.' });
      if (!SAFE.test(version) || version.includes('..')) return res.status(400).json({ error: 'Invalid version (letters, numbers, dot, dash only).' });
      const slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Give the test case a name.' });
      if (!content.trim()) return res.status(400).json({ error: 'The YAML content is empty.' });
      if (content.length > 200000) return res.status(400).json({ error: 'That file is too large.' });

      // Find the next TC-NN number within this version's folder (404 = folder
      // doesn't exist yet → start at TC-01).
      const dir = `flows/${app}/${platform}/${version}`;
      const dirUrl = `https://api.github.com/repos/${REPO}/contents/${dir.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(BRANCH)}`;
      const listRes = await fetch(dirUrl, { headers: ghHeaders('application/vnd.github+json') });
      let maxNum = 0;
      if (listRes.ok) {
        const items = await listRes.json();
        if (Array.isArray(items)) {
          for (const it of items) {
            const mm = /^TC-(\d+)/i.exec(it.name || '');
            if (mm) maxNum = Math.max(maxNum, parseInt(mm[1], 10));
          }
        }
      } else if (listRes.status !== 404) {
        if (listRes.status === 401 || listRes.status === 403) return res.status(502).json({ error: 'GitHub rejected the token — it may lack access to the repo.' });
        return res.status(502).json({ error: `GitHub error listing folder (${listRes.status})` });
      }
      const nn = String(maxNum + 1).padStart(2, '0');
      const filename = `TC-${nn}-${slug}.yaml`;
      const filePathNew = `${dir}/${filename}`;

      const putUrl = `https://api.github.com/repos/${REPO}/contents/${filePathNew.split('/').map(encodeURIComponent).join('/')}`;
      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: Object.assign(ghHeaders('application/vnd.github+json'), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: `Add ${filePathNew} via TestFlow web upload (${payload.email})`,
          content: Buffer.from(content, 'utf8').toString('base64'),
          branch: BRANCH,
        }),
      });
      if (putRes.status === 403 || putRes.status === 401) {
        return res.status(502).json({ error: 'GitHub rejected the write — the GITHUB_TOKEN needs Contents: Read and write.' });
      }
      if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        return res.status(502).json({ error: errData.message || `GitHub error creating file (${putRes.status})` });
      }
      return res.status(200).json({ ok: true, path: filePathNew, filename });
    }

    const filePath = req.query.path;

    // ── single-file view: raw YAML text ────────────────────────────────────
    if (filePath) {
      // Hard guard: only files under flows/ ending in .yaml, no path traversal.
      if (typeof filePath !== 'string' || filePath.includes('..') || !/^flows\/[^\s]+\.yaml$/i.test(filePath)) {
        return res.status(400).json({ error: 'Only flows/**/*.yaml paths can be read.' });
      }
      const encoded = filePath.split('/').map(encodeURIComponent).join('/');
      const url = `https://api.github.com/repos/${REPO}/contents/${encoded}?ref=${encodeURIComponent(BRANCH)}`;
      const r = await fetch(url, { headers: ghHeaders('application/vnd.github.raw') });
      if (r.status === 404) return res.status(404).json({ error: 'Flow not found on GitHub.' });
      if (!r.ok) return res.status(502).json({ error: `GitHub error (${r.status})` });
      const content = await r.text();
      return res.status(200).json({ ok: true, path: filePath, content });
    }

    // ── catalog: the whole flows/ tree in a single call ─────────────────────
    const treeUrl = `https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`;
    const r = await fetch(treeUrl, { headers: ghHeaders('application/vnd.github+json') });
    if (r.status === 404) return res.status(502).json({ error: `Repo or branch not found (${REPO}@${BRANCH}). Check GITHUB_REPO / GITHUB_BRANCH.` });
    if (r.status === 401 || r.status === 403) return res.status(502).json({ error: 'GitHub rejected the token — check GITHUB_TOKEN has read access to the repo.' });
    if (!r.ok) return res.status(502).json({ error: `GitHub error (${r.status})` });
    const data = await r.json();
    const tree = Array.isArray(data.tree) ? data.tree : [];

    const byVersion = {};
    for (const node of tree) {
      if (node.type !== 'blob') continue;
      const m = /^flows\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+\.yaml)$/i.exec(node.path);
      if (!m) continue;
      const app = m[1], platform = m[2], version = m[3], file = m[4];
      const key = `${app}|${platform}|${version}`;
      if (!byVersion[key]) byVersion[key] = { app, platform, version, files: [] };
      byVersion[key].files.push({
        tcId: file.replace(/\.yaml$/i, ''),
        path: node.path,
        isStartup: /^startup/i.test(file),
      });
    }
    const flows = Object.keys(byVersion).sort().map((k) => {
      const v = byVersion[k];
      v.files.sort((a, b) => a.tcId.localeCompare(b.tcId));
      return v;
    });

    return res.status(200).json({ ok: true, flows, truncated: !!data.truncated });
  } catch (err) {
    console.error('[flows]', err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};

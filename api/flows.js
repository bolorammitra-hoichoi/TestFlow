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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const payload = auth.verify(auth.bearer(req));
  if (!payload) return res.status(401).json({ error: 'Session expired — sign in again.' });

  try {
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

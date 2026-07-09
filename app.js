// app.js — TestFlow dashboard. Flat vanilla-JS SPA, same state/render() style
// as BridgeCx's app.js: no build step, no framework, just fetch + DOM.
(function () {
  const root = document.getElementById('app');
  const state = {
    token: localStorage.getItem('tf_token') || null,
    email: localStorage.getItem('tf_email') || null,
    mustChange: localStorage.getItem('tf_must_change') === '1',
    view: 'run', // 'run' | 'history' | 'run-detail'
    error: null,
    agents: [],
    runs: [],
    activeRun: null,
    activeTcResults: [],
    activeLogs: [],
    logsAfter: 0,
    pollTimer: null,
  };

  function setToken(token, email, mustChange) {
    state.token = token; state.email = email; state.mustChange = !!mustChange;
    localStorage.setItem('tf_token', token);
    localStorage.setItem('tf_email', email);
    localStorage.setItem('tf_must_change', mustChange ? '1' : '0');
  }
  function logout() {
    state.token = null; state.email = null; state.mustChange = false;
    localStorage.removeItem('tf_token'); localStorage.removeItem('tf_email'); localStorage.removeItem('tf_must_change');
    render();
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  function renderLogin() {
    root.innerHTML = `
      <header class="tf"><h1>TestFlow <small>hoichoi &amp; sooper internal testing ground</small></h1></header>
      <div class="card" style="max-width:360px;margin:40px auto;">
        <form id="login-form">
          <label>Email</label>
          <input type="email" id="login-email" placeholder="you@hoichoi.tv" required />
          <label>Password</label>
          <input type="password" id="login-password" required />
          <button type="submit">Sign in</button>
          ${state.error ? `<div class="error">${state.error}</div>` : ''}
        </form>
      </div>`;
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      try {
        const data = await api('auth', { method: 'POST', body: { action: 'login', email, password } });
        setToken(data.token, data.email, data.mustChange);
        state.error = null;
        render();
      } catch (err) {
        state.error = err.message;
        render();
      }
    };
  }

  // ── Set password (forced after first login on the shared default) ──────────
  function renderSetPassword() {
    root.innerHTML = `
      <header class="tf"><h1>TestFlow <small>hoichoi &amp; sooper internal testing ground</small></h1></header>
      <div class="card" style="max-width:360px;margin:40px auto;">
        <p style="margin-top:0;color:var(--muted);font-size:13px;">You're signed in with the shared default password. Set a personal one before continuing.</p>
        <form id="setpw-form">
          <label>New password (min 8 characters)</label>
          <input type="password" id="setpw-new" minlength="8" required />
          <button type="submit">Set password</button>
          ${state.error ? `<div class="error">${state.error}</div>` : ''}
        </form>
      </div>`;
    document.getElementById('setpw-form').onsubmit = async (e) => {
      e.preventDefault();
      const newPassword = document.getElementById('setpw-new').value;
      try {
        const data = await api('auth', { method: 'POST', body: { action: 'set-password', newPassword } });
        setToken(data.token, data.email, data.mustChange);
        state.error = null;
        render();
      } catch (err) {
        state.error = err.message;
        render();
      }
    };
  }

  // ── Shell (header + nav) ────────────────────────────────────────────────────
  function renderShell(innerHtml) {
    root.innerHTML = `
      <header class="tf">
        <h1>TestFlow <small>hoichoi &amp; sooper internal testing ground</small></h1>
        <div>
          <nav class="tf" style="display:inline">
            <a data-view="run" class="${state.view === 'run' ? 'active' : ''}">Run Test</a>
            <a data-view="history" class="${state.view === 'history' ? 'active' : ''}">History</a>
          </nav>
          <span style="color:var(--muted);font-size:13px;margin-left:20px;">${state.email}</span>
          <a id="logout" style="margin-left:12px;color:var(--muted);cursor:pointer;font-size:13px;">Sign out</a>
        </div>
      </header>
      <div id="tf-body">${innerHtml}</div>`;
    root.querySelectorAll('nav.tf a').forEach((a) => {
      a.onclick = () => { state.view = a.dataset.view; state.activeRun = null; render(); };
    });
    document.getElementById('logout').onclick = logout;
  }

  // ── Run Test ────────────────────────────────────────────────────────────────
  async function renderRun() {
    renderShell(`<div class="card">Loading agents…</div>`);
    try {
      const data = await api('agents');
      state.agents = data.agents || [];
    } catch (err) {
      renderShell(`<div class="card error">Failed to load agents: ${err.message}</div>`);
      return;
    }

    const body = document.getElementById('tf-body');
    if (!state.agents.length) {
      body.innerHTML = `<div class="card">No runner agents have connected yet. Start one from <code>runner-agent/</code> on a machine with a phone plugged in.</div>`;
      return;
    }

    body.innerHTML = `
      <div class="card">
        <label>Agent (machine + connected device)</label>
        <select id="rt-agent">
          ${state.agents.map((a) => {
            const staleMs = Date.now() - toMillis(a.lastHeartbeatAt);
            const offline = staleMs > 30000;
            const deviceLabel = (a.connectedDevices || []).map((d) => `${d.model} (${d.serial})`).join(', ') || 'no device connected';
            return `<option value="${a.id}">${a.ownerEmail} — ${a.hostname} — ${deviceLabel}${offline ? ' [offline]' : ''}</option>`;
          }).join('')}
        </select>

        <label>App</label>
        <select id="rt-app"></select>
        <label>Platform</label>
        <select id="rt-platform"></select>
        <label>Version</label>
        <select id="rt-version"></select>

        <label>Test cases</label>
        <div id="rt-tcs"></div>

        <button id="rt-submit">Run</button>
        <div id="rt-error" class="error"></div>
      </div>`;

    function currentAgent() { return state.agents.find((a) => a.id === document.getElementById('rt-agent').value); }
    function refreshApps() {
      const manifest = currentAgent()?.manifest || [];
      const apps = [...new Set(manifest.map((m) => m.app))];
      document.getElementById('rt-app').innerHTML = apps.map((a) => `<option value="${a}">${a}</option>`).join('') || '<option>—</option>';
      refreshPlatforms();
    }
    function refreshPlatforms() {
      const manifest = currentAgent()?.manifest || [];
      const app = document.getElementById('rt-app').value;
      const platforms = [...new Set(manifest.filter((m) => m.app === app).map((m) => m.platform))];
      document.getElementById('rt-platform').innerHTML = platforms.map((p) => `<option value="${p}">${p}</option>`).join('') || '<option>—</option>';
      refreshVersions();
    }
    function refreshVersions() {
      const manifest = currentAgent()?.manifest || [];
      const app = document.getElementById('rt-app').value;
      const platform = document.getElementById('rt-platform').value;
      const versions = manifest.filter((m) => m.app === app && m.platform === platform).map((m) => m.version);
      document.getElementById('rt-version').innerHTML = versions.map((v) => `<option value="${v}">${v}</option>`).join('') || '<option>—</option>';
      refreshTcs();
    }
    function refreshTcs() {
      const manifest = currentAgent()?.manifest || [];
      const app = document.getElementById('rt-app').value;
      const platform = document.getElementById('rt-platform').value;
      const version = document.getElementById('rt-version').value;
      const entry = manifest.find((m) => m.app === app && m.platform === platform && m.version === version);
      const tcIds = entry ? entry.tcIds : [];
      document.getElementById('rt-tcs').innerHTML = `
        <div class="tc-checkbox"><label style="margin:0;display:inline;color:var(--text);font-weight:600;"><input type="checkbox" id="rt-all" checked /> Run all (${tcIds.length})</label></div>
        ${tcIds.map((id) => `<div class="tc-checkbox"><input type="checkbox" class="rt-tc" value="${id}" disabled checked /> ${id}</div>`).join('')}`;
      document.getElementById('rt-all').onchange = (e) => {
        document.querySelectorAll('.rt-tc').forEach((cb) => { cb.disabled = e.target.checked; if (e.target.checked) cb.checked = true; });
      };
    }

    document.getElementById('rt-agent').onchange = refreshApps;
    document.getElementById('rt-app').onchange = refreshPlatforms;
    document.getElementById('rt-platform').onchange = refreshVersions;
    document.getElementById('rt-version').onchange = refreshTcs;
    refreshApps();

    document.getElementById('rt-submit').onclick = async () => {
      const runAll = document.getElementById('rt-all').checked;
      const tcIds = runAll ? [] : [...document.querySelectorAll('.rt-tc:checked')].map((cb) => cb.value);
      try {
        const data = await api('runs', {
          method: 'POST',
          body: {
            agentId: document.getElementById('rt-agent').value,
            app: document.getElementById('rt-app').value,
            platform: document.getElementById('rt-platform').value,
            version: document.getElementById('rt-version').value,
            tcIds,
          },
        });
        openRun(data.runId);
      } catch (err) {
        document.getElementById('rt-error').textContent = err.message;
      }
    };
  }

  // ── Live Run / Run Detail ───────────────────────────────────────────────────
  function toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (ts._seconds) return ts._seconds * 1000;
    return new Date(ts).getTime() || 0;
  }

  function openRun(runId) {
    state.view = 'run-detail';
    state.activeRun = { id: runId };
    state.activeLogs = [];
    state.logsAfter = 0;
    render();
  }

  async function renderRunDetail() {
    renderShell(`<div class="card">Loading run…</div>`);
    await refreshRunDetail();
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (!state.activeRun || state.view !== 'run-detail') { clearInterval(state.pollTimer); return; }
      await refreshRunDetail();
      const status = state.activeRun.status;
      if (status && !['queued', 'claimed', 'running'].includes(status)) clearInterval(state.pollTimer);
    }, 2000);
  }

  async function refreshRunDetail() {
    const runId = state.activeRun.id;
    try {
      const data = await api(`runs/${runId}`);
      state.activeRun = data.run;
      state.activeTcResults = data.tcResults;
    } catch (err) {
      document.getElementById('tf-body').innerHTML = `<div class="card error">${err.message}</div>`;
      return;
    }
    try {
      const logData = await api(`runs/${runId}/logs${state.logsAfter ? `?after=${state.logsAfter}` : ''}`);
      if (logData.lines && logData.lines.length) {
        state.activeLogs.push(...logData.lines);
        state.logsAfter = logData.lines[logData.lines.length - 1].ts;
      }
    } catch (e) { /* log polling is best-effort */ }

    renderRunDetailBody();
  }

  function renderRunDetailBody() {
    const run = state.activeRun;
    const body = document.getElementById('tf-body');
    body.innerHTML = `
      <div class="card">
        <div><strong>${run.app} / ${run.platform} / ${run.version}</strong> <span class="badge ${run.status}">${run.status}</span></div>
        <div style="color:var(--muted);font-size:13px;margin-top:6px;">
          Requested by ${run.requestedByEmail} · Build ${run.buildNumber || '—'} · Device ${run.device ? `${run.device.model} (${run.device.serial})` : '—'}
        </div>
      </div>
      <div class="card">
        <strong>Live log</strong>
        <pre class="log">${state.activeLogs.map((l) => `[${l.tcId}] ${escapeHtml(l.line)}`).join('\n') || '(no log lines yet)'}</pre>
      </div>
      <div class="card">
        <strong>Test cases</strong>
        ${(run.tcSummary || []).map((tc) => `
          <div style="margin-top:10px;">
            <span class="badge ${tc.status}">${tc.status}</span> ${tc.name} ${tc.flagCount ? `<span class="badge offline">${tc.flagCount} flag(s)</span>` : ''}
          </div>`).join('') || '<div style="color:var(--muted);">Results appear here once the agent finishes.</div>'}
      </div>
      ${state.activeTcResults.map(renderTcDetail).join('')}`;
  }

  function renderTcDetail(tc) {
    // No Storage in v1 — screenshots live only on the tester's machine, so we
    // just list filenames/flags instead of rendering images.
    return `
      <div class="card">
        <strong>${tc.name}</strong> <span class="badge ${tc.status}">${tc.status}</span>
        ${tc.errorMessage ? `<pre class="log">${escapeHtml(tc.errorMessage)}</pre>` : ''}
        ${(tc.screenshots || []).length ? `
          <div style="margin-top:10px;font-size:13px;color:var(--muted);">
            Screenshots (on tester's machine only):
            ${tc.screenshots.map((s) => `<div>${s.flagged ? '<span class="badge offline">FLAG</span> ' : ''}${escapeHtml(s.name)}</div>`).join('')}
          </div>` : ''}
      </div>`;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  // ── History ─────────────────────────────────────────────────────────────────
  async function renderHistory() {
    renderShell(`<div class="card">Loading history…</div>`);
    try {
      const data = await api('runs');
      state.runs = data.runs || [];
    } catch (err) {
      document.getElementById('tf-body').innerHTML = `<div class="card error">${err.message}</div>`;
      return;
    }
    const body = document.getElementById('tf-body');
    body.innerHTML = `
      <div class="card">
        <table>
          <thead><tr><th>App</th><th>Platform</th><th>Version</th><th>Build</th><th>Tester</th><th>Status</th><th>Requested</th></tr></thead>
          <tbody>
            ${state.runs.map((r) => `
              <tr class="clickable" data-id="${r.id}">
                <td>${r.app}</td><td>${r.platform}</td><td>${r.version}</td><td>${r.buildNumber || '—'}</td>
                <td>${r.requestedByEmail}</td><td><span class="badge ${r.status}">${r.status}</span></td>
                <td>${r.requestedAt ? new Date(toMillis(r.requestedAt)).toLocaleString() : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${!state.runs.length ? '<div style="color:var(--muted);margin-top:10px;">No runs yet.</div>' : ''}
      </div>`;
    body.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.onclick = () => openRun(tr.dataset.id);
    });
  }

  // ── Router ──────────────────────────────────────────────────────────────────
  function render() {
    if (!state.token) return renderLogin();
    if (state.mustChange) return renderSetPassword();
    if (state.view === 'history') return renderHistory();
    if (state.view === 'run-detail') return renderRunDetail();
    return renderRun();
  }

  render();
})();

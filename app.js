// app.js — TestFlow dashboard. Flat vanilla-JS SPA, no build step, no framework.
// Visual design ported from the Claude Design handoff
// (design_handoff_testflow_qa_dashboard) — see TestFlow.dc.html for the
// reference prototype. Every screen here is wired to the real API; nothing
// is simulated.
(function () {
  const root = document.getElementById('app');

  const state = {
    token: localStorage.getItem('tf_token') || null,
    email: localStorage.getItem('tf_email') || null,
    mustChange: localStorage.getItem('tf_must_change') === '1',
    theme: localStorage.getItem('tf_theme') || 'dark',
    view: 'run', // 'run' | 'history' | 'run-detail'
    error: null,
    agents: [],
    recentRuns: [],
    selAgentId: null, selApp: null, selPlatform: null, selVersion: null,
    runAll: true, selTcs: {},
    activeRun: null, activeTcResults: [], activeLogs: [], logsAfter: 0,
    pendingTcIds: null, isLiveView: false, pollTimer: null,
    expanded: {},
    histSearch: '', fApp: 'all', fPlatform: 'all', fStatus: 'all',
  };

  document.documentElement.setAttribute('data-theme', state.theme);

  // ── persistence ──────────────────────────────────────────────────────────
  function setToken(token, email, mustChange) {
    state.token = token; state.email = email; state.mustChange = !!mustChange;
    localStorage.setItem('tf_token', token);
    localStorage.setItem('tf_email', email);
    localStorage.setItem('tf_must_change', mustChange ? '1' : '0');
  }
  function logout() {
    state.token = null; state.email = null; state.mustChange = false;
    localStorage.removeItem('tf_token'); localStorage.removeItem('tf_email'); localStorage.removeItem('tf_must_change');
    if (state.pollTimer) clearInterval(state.pollTimer);
    render();
  }
  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('tf_theme', state.theme);
    document.documentElement.setAttribute('data-theme', state.theme);
    render();
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Session expired or invalid — drop straight back to login instead of
      // stranding the user on a broken page with a dead token.
      logout();
      throw new Error('Session expired — signed you out, please sign in again.');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (ts._seconds) return ts._seconds * 1000;
    return new Date(ts).getTime() || 0;
  }
  // avoids a double "v" if the version string already has one (e.g. a
  // placeholder folder name like "v-current" instead of a real "9.4.2")
  function fmtVersion(v) { return v == null ? '' : (/^v/i.test(v) ? v : 'v' + v); }
  function fmtDur(sec) {
    if (!sec || sec < 0) return '—';
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  }
  function runDurationSec(run) {
    if (!run.startedAt || !run.finishedAt) return null;
    return (toMillis(run.finishedAt) - toMillis(run.startedAt)) / 1000;
  }
  function fmtRelative(ms) {
    if (!ms) return '—';
    const d = new Date(ms), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `Today, ${time}`;
    if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
    const days = Math.floor((now - d) / 86400000);
    return days <= 6 ? `${days} days ago` : d.toLocaleDateString();
  }
  // "TC-01-app-launch-and-navigation" -> { id: "TC-01", name: "App launch and navigation" }
  function parseTc(tcId) {
    const m = /^(TC-\d+)-(.+)$/i.exec(tcId);
    if (!m) return { id: tcId, name: tcId };
    const name = m[2].replace(/-/g, ' ');
    return { id: m[1], name: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  // Agent heartbeats every ~10s; 45s gives a few missed/delayed beats of
  // slack before flagging offline, instead of flickering on ordinary jitter.
  function isAgentOnline(a) { return Date.now() - toMillis(a.lastHeartbeatAt) < 45000; }

  // ── icons (ported from the design handoff's inline SVGs) ────────────────
  const ICON = {
    play: (c = '#fff') => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
    sun: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>`,
    moon: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`,
    logout: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" x2="9" y1="12" y2="12"></line></svg>`,
    phone: () => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"></rect><path d="M9 22h6"></path></svg>`,
    phoneSlash: () => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"></rect><path d="M9 22h6"></path><line x1="2" x2="22" y1="2" y2="22"></line></svg>`,
    back: () => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg>`,
    search: () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>`,
    warn: (c = 'var(--warn)') => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`,
    check: (c) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    x: (c = 'var(--bad)') => `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round"><line x1="18" x2="6" y1="6" y2="18"></line><line x1="6" x2="18" y1="6" y2="18"></line></svg>`,
    flag: (c = 'currentColor', w = 13) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" x2="4" y1="22" y2="15"></line></svg>`,
    image: (c = 'var(--tx3)') => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"></path></svg>`,
    android: () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"></rect><path d="M9 22h6"></path></svg>`,
    ios: () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2.5"></rect><path d="M12 18h.01"></path></svg>`,
    chevron: () => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>`,
    stop: () => `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>`,
    refresh: () => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>`,
    inbox: () => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path></svg>`,
    runIcon: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`,
  };
  function tcStatusIcon(status) {
    if (status === 'passed') return `<span class="tf-tc-icon passed">${ICON.check('var(--ok)')}</span>`;
    if (status === 'failed') return `<span class="tf-tc-icon failed">${ICON.x()}</span>`;
    if (status === 'running') return `<span class="tf-tc-icon running tf-live-dot"></span>`;
    return `<span class="tf-tc-icon queued"></span>`;
  }

  const APP_META = { hoichoi: { name: 'hoichoi', glyph: 'হ' }, sooper: { name: 'sooper', glyph: 'S' } };
  function platformLabel(p) { return p === 'ios' ? 'iOS' : 'Android'; }

  // ── login / set password ─────────────────────────────────────────────────
  function renderLogin() {
    root.innerHTML = `
      <div class="tf-login-screen">
        <div class="tf-login-wrap">
          <div class="tf-login-logo-row">
            <div class="tf-logo-tile lg">${ICON.play()}</div>
            <div class="tf-wordmark lg">TestFlow</div>
          </div>
          <div class="tf-card shadow">
            <div class="tf-form-title">Sign in</div>
            <div class="tf-form-sub">hoichoi &amp; sooper internal testing ground</div>
            <form id="login-form">
              <label class="tf-label">Email</label>
              <input class="tf-input" type="email" id="login-email" placeholder="you@hoichoi.tv" required />
              <label class="tf-label">Password</label>
              <input class="tf-input" type="password" id="login-password" required />
              <button class="tf-btn" type="submit">Sign in</button>
              ${state.error ? `<div class="tf-error">${escapeHtml(state.error)}</div>` : ''}
            </form>
          </div>
        </div>
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
      } catch (err) { state.error = err.message; render(); }
    };
  }

  function renderSetPassword() {
    root.innerHTML = `
      <div class="tf-login-screen">
        <div class="tf-login-wrap">
          <div class="tf-login-logo-row">
            <div class="tf-logo-tile lg">${ICON.play()}</div>
            <div class="tf-wordmark lg">TestFlow</div>
          </div>
          <div class="tf-card shadow">
            <div class="tf-warn-banner">${ICON.warn()}<div>You're signed in with the <strong style="color:var(--tx1)">shared default password</strong>. Set a personal one to continue.</div></div>
            <form id="setpw-form">
              <label class="tf-label">New password</label>
              <input class="tf-input" type="password" id="setpw-new" minlength="8" placeholder="At least 8 characters" required />
              <button class="tf-btn" type="submit">Set password &amp; continue</button>
              ${state.error ? `<div class="tf-error">${escapeHtml(state.error)}</div>` : ''}
            </form>
          </div>
        </div>
      </div>`;
    document.getElementById('setpw-form').onsubmit = async (e) => {
      e.preventDefault();
      const newPassword = document.getElementById('setpw-new').value;
      try {
        const data = await api('auth', { method: 'POST', body: { action: 'set-password', newPassword } });
        setToken(data.token, data.email, data.mustChange);
        state.error = null;
        render();
      } catch (err) { state.error = err.message; render(); }
    };
  }

  // ── shell (nav) ──────────────────────────────────────────────────────────
  function renderShell(bodyHtml) {
    const initials = (state.email.split('@')[0].split('.').map((x) => x[0]).join('') || '?').slice(0, 2).toUpperCase();
    root.innerHTML = `
      <nav class="tf-nav">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="tf-logo-tile">${ICON.play()}</div>
          <div><div class="tf-wordmark">TestFlow</div><div class="tf-tagline">hoichoi &amp; sooper internal testing ground</div></div>
        </div>
        <div class="tf-nav-links">
          <div class="tf-nav-link ${state.view === 'run' ? 'active' : ''}" data-nav="run">Run Test</div>
          <div class="tf-nav-link ${state.view === 'history' || state.view === 'run-detail' ? 'active' : ''}" data-nav="history">History</div>
        </div>
        <div class="tf-nav-spacer"></div>
        <div class="tf-theme-toggle" id="theme-toggle" title="Toggle theme">${state.theme === 'dark' ? ICON.sun() : ICON.moon()}</div>
        <div class="tf-user">
          <div class="tf-avatar">${initials}</div>
          <div style="font-size:12.5px;color:var(--tx2);">${escapeHtml(state.email)}</div>
          <div class="tf-signout" id="signout" title="Sign out">${ICON.logout()}</div>
        </div>
      </nav>
      <div class="tf-scroll" id="tf-body">${bodyHtml}</div>`;
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.onclick = () => { state.view = el.dataset.nav; if (state.pollTimer) clearInterval(state.pollTimer); render(); };
    });
    document.getElementById('theme-toggle').onclick = toggleTheme;
    document.getElementById('signout').onclick = logout;
  }

  // ── Run Test ─────────────────────────────────────────────────────────────
  async function renderRun() {
    renderShell(`<div class="tf-page">Loading…</div>`);
    let recentRuns = [];
    try {
      const [agentsData, runsData] = await Promise.all([api('agents'), api('runs?limit=20')]);
      state.agents = agentsData.agents || [];
      recentRuns = runsData.runs || [];
    } catch (err) {
      const body = document.getElementById('tf-body');
      if (body) body.innerHTML = `<div class="tf-page"><div class="tf-card tf-error">${escapeHtml(err.message)}</div></div>`;
      return;
    }
    state.recentRuns = recentRuns;

    if (!state.selAgentId) {
      const firstOnline = state.agents.find(isAgentOnline);
      if (firstOnline) state.selAgentId = firstOnline.id;
    }
    if (!state.selApp) state.selApp = 'hoichoi';
    if (!state.selPlatform) state.selPlatform = 'android';

    const busyAgentIds = new Set(recentRuns.filter((r) => ['claimed', 'running'].includes(r.status)).map((r) => r.agentId));
    const runningNow = recentRuns.filter((r) => r.status === 'running' || r.status === 'claimed');

    const selAgent = state.agents.find((a) => a.id === state.selAgentId);
    const manifestForAgent = selAgent ? selAgent.manifest || [] : [];
    const apps = [...new Set(manifestForAgent.map((m) => m.app))];
    if (apps.length && !apps.includes(state.selApp)) state.selApp = apps[0];
    const platforms = [...new Set(manifestForAgent.filter((m) => m.app === state.selApp).map((m) => m.platform))];
    if (platforms.length && !platforms.includes(state.selPlatform)) state.selPlatform = platforms[0];
    const versions = manifestForAgent.filter((m) => m.app === state.selApp && m.platform === state.selPlatform).map((m) => m.version);
    if (!state.selVersion || !versions.includes(state.selVersion)) state.selVersion = versions[0] || null;
    const entry = manifestForAgent.find((m) => m.app === state.selApp && m.platform === state.selPlatform && m.version === state.selVersion);
    const tcIds = entry ? entry.tcIds : [];

    const agOk = !!(selAgent && isAgentOnline(selAgent));
    const selCount = state.runAll ? tcIds.length : tcIds.filter((id) => state.selTcs[id]).length;
    const canRun = agOk && selCount > 0;

    const agentListHtml = state.agents.length ? `
      <div class="tf-agent-list">
        ${state.agents.map((a) => {
          const online = isAgentOnline(a);
          const busy = online && busyAgentIds.has(a.id);
          const selected = a.id === state.selAgentId && online;
          const badgeSt = !online ? 'offline' : (busy ? 'busy' : 'online');
          const minsAgo = Math.max(0, Math.round((Date.now() - toMillis(a.lastHeartbeatAt)) / 60000));
          const badgeText = !online ? `offline ${minsAgo}m ago` : (busy ? 'busy' : 'online · idle');
          return `<div class="tf-row-btn tf-agent-row ${selected ? 'selected' : ''} ${!online ? 'disabled' : ''}" data-agent="${a.id}">
            <div class="tf-agent-icon">${ICON.phone()}</div>
            <div class="tf-agent-main">
              <div class="tf-agent-top">
                <span class="tf-agent-owner">${escapeHtml(a.ownerEmail)}</span>
                <span class="tf-agent-host">${escapeHtml(a.hostname)}</span>
                <span class="tf-badge sm" data-st="${badgeSt}"><span class="tf-badge-dot ${online ? 'tf-live-dot' : ''}"></span>${badgeText}</span>
              </div>
              <div class="tf-agent-devices">
                ${(a.connectedDevices || []).map((d) => `<div class="tf-device-line">
                  <span class="tf-os-chip">${platformLabel(d.platform)}</span>
                  <span class="tf-device-model">${escapeHtml(d.model)}</span>
                  <span class="tf-device-serial">${escapeHtml(d.serial)}</span>
                </div>`).join('') || '<div class="tf-device-line" style="color:var(--tx3)">no device connected</div>'}
              </div>
            </div>
            <div class="tf-agent-check">${selected ? ICON.check('var(--accent)') : ''}</div>
          </div>`;
        }).join('')}
      </div>` : `
      <div class="tf-empty-state">
        <div class="tf-empty-icon">${ICON.phoneSlash()}</div>
        <div class="tf-empty-title">No agents connected</div>
        <div class="tf-empty-body">Start the TestFlow agent on your machine and plug in a device over USB. It'll appear here within a few seconds.</div>
        <div class="tf-cmd-chip"><span style="color:var(--tx3)">$</span> npm start (from runner-agent/)</div>
      </div>`;

    document.getElementById('tf-body').innerHTML = `
      <div class="tf-page">
        <div style="margin-bottom:22px;"><h1 class="tf-page-title">Run a test</h1><div class="tf-page-sub">Configure an automated Maestro suite against a plugged-in device.</div></div>
        <div class="tf-run-grid">
          <div class="tf-card">
            <div class="tf-section-head">
              <div class="tf-eyebrow">Agent &amp; device</div>
              <div class="tf-live-poll"><span class="tf-badge-dot tf-live-dot" style="background:var(--ok);"></span>polling every 10s</div>
            </div>
            ${agentListHtml}

            <div class="tf-divider"></div>
            <div class="tf-2col">
              <div>
                <div class="tf-eyebrow" style="margin-bottom:10px;">App</div>
                <div class="tf-tile-row">
                  ${['hoichoi', 'sooper'].map((id) => `<div class="tf-row-btn tf-tile ${state.selApp === id ? 'selected' : ''}" data-app="${id}" data-select-app="${id}">
                    <span class="tf-app-tile" data-app="${id}">${APP_META[id].glyph}</span><span class="tf-tile-label">${APP_META[id].name}</span>
                  </div>`).join('')}
                </div>
              </div>
              <div>
                <div class="tf-eyebrow" style="margin-bottom:10px;">Platform</div>
                <div class="tf-tile-row">
                  ${['android', 'ios'].map((id) => `<div class="tf-row-btn tf-tile platform ${state.selPlatform === id ? 'selected' : ''}" data-select-platform="${id}">
                    ${id === 'android' ? ICON.android() : ICON.ios()}<span class="tf-tile-label">${platformLabel(id)}</span>
                  </div>`).join('')}
                </div>
              </div>
            </div>

            <div style="margin-top:18px;">
              <div class="tf-eyebrow" style="margin-bottom:10px;">Version</div>
              <div class="tf-pill-row">
                ${versions.length ? versions.map((v) => `<div class="tf-row-btn tf-pill ${state.selVersion === v ? 'selected' : ''}" data-select-version="${escapeHtml(v)}">${escapeHtml(fmtVersion(v))}</div>`).join('')
                  : `<div style="font-size:12.5px;color:var(--tx3);">No versions available for this app/platform on the selected agent.</div>`}
              </div>
            </div>

            <div class="tf-divider"></div>
            <div class="tf-section-head">
              <div class="tf-eyebrow">Test cases <span style="color:var(--tx3);font-weight:500;">· ${selCount} selected</span></div>
              <div class="tf-toggle-row" id="toggle-run-all">
                <span class="tf-toggle-label ${state.runAll ? 'on' : ''}">Run all</span>
                <span class="tf-toggle-track ${state.runAll ? 'on' : ''}"><span class="tf-toggle-knob ${state.runAll ? 'on' : ''}"></span></span>
              </div>
            </div>
            <div class="tf-tc-grid">
              ${tcIds.map((tcId) => {
                const on = state.runAll || !!state.selTcs[tcId];
                const { id, name } = parseTc(tcId);
                return `<div class="tf-row-btn tf-tc-checkbox ${on && !state.runAll ? 'on' : ''} ${state.runAll ? 'locked' : ''}" data-tc="${escapeHtml(tcId)}">
                  <span class="tf-checkbox-box ${on ? 'on' : ''}">${on ? ICON.check('#fff') : ''}</span>
                  <span class="tf-tc-id">${id}</span><span class="tf-tc-name">${escapeHtml(name)}</span>
                </div>`;
              }).join('')}
            </div>

            <div class="tf-run-actions">
              <button class="tf-btn-run" id="run-btn" ${canRun ? '' : 'disabled'}>${ICON.runIcon()}Run ${state.runAll ? `all ${selCount}` : `${selCount} ${selCount === 1 ? 'case' : 'cases'}`}</button>
              <div class="tf-run-summary">${!agOk ? 'Select an online agent to run.' : (selCount === 0 ? 'Select at least one test case.' : `${APP_META[state.selApp].name} · ${platformLabel(state.selPlatform)} · ${state.selVersion ? fmtVersion(state.selVersion) : '—'}`)}</div>
            </div>
          </div>

          <div class="tf-sidebar">
            <div class="tf-sidebar-card">
              <div class="tf-sidebar-head"><div class="tf-eyebrow sm" style="display:flex;align-items:center;gap:7px;"><span class="tf-badge-dot tf-live-dot" style="background:var(--run);"></span>Currently running</div></div>
              ${runningNow.length ? runningNow.map((r) => {
                const pct = r.totalTcs ? Math.round(100 * (r.tcSummary || []).filter((t) => t.status === 'passed' || t.status === 'failed').length / r.totalTcs) : 0;
                const settled = (r.tcSummary || []).filter((t) => t.status === 'passed' || t.status === 'failed').length;
                return `<div class="tf-row-btn tf-running-row" data-open-run="${r.id}" data-live="1">
                  <div class="tf-running-top"><span class="tf-app-dot" data-app="${r.app}"></span><span style="font-family:var(--ui);font-weight:600;font-size:13px;">${APP_META[r.app].name}</span><span style="font-family:var(--mono);font-size:11px;color:var(--tx3);">${platformLabel(r.platform)} · ${escapeHtml(fmtVersion(r.version))}</span></div>
                  <div style="display:flex;align-items:center;gap:8px;"><div class="tf-progress-track"><div class="tf-progress-fill" style="width:${pct}%;"></div></div><span style="font-family:var(--mono);font-size:11px;color:var(--tx2);">${settled}/${r.totalTcs || '?'}</span></div>
                </div>`;
              }).join('') : `<div class="tf-empty-note">Nothing running right now.</div>`}
            </div>
            <div class="tf-sidebar-card">
              <div class="tf-sidebar-head"><div class="tf-eyebrow sm">Recent runs</div><div style="cursor:pointer;font-size:12px;color:var(--accent);" data-nav="history">View all</div></div>
              <div style="display:flex;flex-direction:column;gap:2px;">
                ${recentRuns.slice(0, 5).map((r) => `<div class="tf-row-btn tf-recent-row" data-open-run="${r.id}">
                  <span class="tf-badge-dot" data-st="${r.status}"></span>
                  <span style="font-family:var(--ui);font-weight:600;font-size:12.5px;" data-app="${r.app}">${APP_META[r.app].name}</span>
                  <span style="font-family:var(--mono);font-size:11px;color:var(--tx3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${platformLabel(r.platform)} ${escapeHtml(fmtVersion(r.version))}${r.device ? ' · ' + escapeHtml(r.device.model) : ''}</span>
                  <span style="font-size:11px;color:var(--tx3);">${fmtRelative(toMillis(r.requestedAt)).split(',')[0]}</span>
                </div>`).join('') || `<div class="tf-empty-note">No runs yet.</div>`}
              </div>
            </div>
          </div>
        </div>
      </div>`;

    // wire interactions
    document.querySelectorAll('[data-agent]').forEach((el) => {
      el.onclick = () => { const a = state.agents.find((x) => x.id === el.dataset.agent); if (a && isAgentOnline(a)) { state.selAgentId = a.id; renderRun(); } };
    });
    document.querySelectorAll('[data-select-app]').forEach((el) => { el.onclick = () => { state.selApp = el.dataset.selectApp; state.selVersion = null; state.selTcs = {}; renderRun(); }; });
    document.querySelectorAll('[data-select-platform]').forEach((el) => { el.onclick = () => { state.selPlatform = el.dataset.selectPlatform; state.selVersion = null; state.selTcs = {}; renderRun(); }; });
    document.querySelectorAll('[data-select-version]').forEach((el) => { el.onclick = () => { state.selVersion = el.dataset.selectVersion; state.selTcs = {}; renderRun(); }; });
    document.getElementById('toggle-run-all').onclick = () => { state.runAll = !state.runAll; renderRun(); };
    document.querySelectorAll('[data-tc]').forEach((el) => {
      el.onclick = () => { if (state.runAll) return; const id = el.dataset.tc; state.selTcs[id] = !state.selTcs[id]; renderRun(); };
    });
    document.querySelectorAll('[data-open-run]').forEach((el) => {
      el.onclick = () => openRun(el.dataset.openRun, { live: el.dataset.live === '1' });
    });
    const runBtn = document.getElementById('run-btn');
    if (runBtn) runBtn.onclick = async () => {
      if (!canRun) return;
      try {
        const data = await api('runs', { method: 'POST', body: { agentId: state.selAgentId, app: state.selApp, platform: state.selPlatform, version: state.selVersion, tcIds: state.runAll ? [] : Object.keys(state.selTcs).filter((k) => state.selTcs[k]) } });
        openRun(data.runId, { live: true, pendingTcIds: state.runAll ? tcIds : Object.keys(state.selTcs).filter((k) => state.selTcs[k]) });
      } catch (err) { alert(err.message); }
    };
  }

  // ── Live Run / Run Detail ───────────────────────────────────────────────
  function openRun(runId, { live = false, pendingTcIds = null } = {}) {
    state.view = 'run-detail';
    state.activeRun = { id: runId };
    state.activeTcResults = [];
    state.activeLogs = [];
    state.logsAfter = 0;
    state.isLiveView = live;
    state.pendingTcIds = pendingTcIds;
    state.expanded = {};
    render();
  }

  async function renderRunDetail() {
    renderShell(`<div class="tf-page">Loading run…</div>`);
    if (state.pollTimer) clearInterval(state.pollTimer);
    await refreshRunDetail();
    state.pollTimer = setInterval(async () => {
      if (state.view !== 'run-detail' || !state.activeRun) { clearInterval(state.pollTimer); return; }
      await refreshRunDetail();
      if (!['queued', 'claimed', 'running'].includes(state.activeRun.status)) clearInterval(state.pollTimer);
    }, 2000);
  }

  async function refreshRunDetail() {
    const runId = state.activeRun.id;
    try {
      const data = await api(`runs/${runId}`);
      state.activeRun = data.run;
      state.activeTcResults = data.tcResults || [];
    } catch (err) {
      const body = document.getElementById('tf-body');
      if (body) body.innerHTML = `<div class="tf-page"><div class="tf-card tf-error">${escapeHtml(err.message)}</div></div>`;
      return;
    }
    if (state.isLiveView) {
      try {
        const logData = await api(`runs/${runId}/logs${state.logsAfter ? `?after=${state.logsAfter}` : ''}`);
        if (logData.lines && logData.lines.length) {
          state.activeLogs.push(...logData.lines);
          state.logsAfter = logData.lines[logData.lines.length - 1].ts;
        }
      } catch (e) { /* best-effort */ }
    }
    renderRunDetailBody();
  }

  function lastLogLineFor(tcId) {
    for (let i = state.activeLogs.length - 1; i >= 0; i--) {
      if (state.activeLogs[i].tcId === tcId) return state.activeLogs[i].line;
    }
    return null;
  }

  function runHeaderHtml(run) {
    const am = APP_META[run.app];
    const st = run.status;
    let stText = { passed: 'Passed', failed: 'Failed', running: 'Running', claimed: 'Claimed', queued: 'Queued', cancelled: 'Cancelled' }[st] || st;
    if (st === 'cancelled') {
      if (run.failureReason === 'agent_restarted') stText = 'Cancelled — agent restarted';
      else if (run.failureReason === 'stale_timeout') stText = 'Cancelled — timed out';
      else stText = 'Cancelled by you';
    }
    const durSec = runDurationSec(run);
    const tcSummary = run.tcSummary || [];
    const passCount = tcSummary.filter((t) => t.status === 'passed').length;
    const failCount = tcSummary.filter((t) => t.status === 'failed').length;
    const flagCount = tcSummary.reduce((a, t) => a + (t.flagCount || 0), 0);
    const meta = (k, v) => `<div><div class="tf-meta-k">${k}</div><div class="tf-meta-v">${v}</div></div>`;

    const inFlight = ['queued', 'claimed', 'running'].includes(st);
    const finished = ['passed', 'failed', 'cancelled'].includes(st);
    const allTcIds = tcSummary.map((t) => t.tcId);
    const failedTcIds = tcSummary.filter((t) => t.status !== 'passed').map((t) => t.tcId);
    const actionsHtml = (inFlight || finished) ? `
      <div class="tf-divider"></div>
      <div style="display:flex;align-items:center;gap:10px;">
        ${inFlight ? `<button class="tf-btn-stop" data-action="cancel-run">${ICON.stop()}Stop</button>` : ''}
        ${finished && failedTcIds.length ? `<button class="tf-btn-rerun" data-action="rerun-run" data-tcids="${escapeHtml(JSON.stringify(failedTcIds))}">${ICON.refresh()}Rerun failed (${failedTcIds.length})</button>` : ''}
        ${finished ? `<button class="tf-btn-rerun secondary" data-action="rerun-run" data-tcids="${escapeHtml(JSON.stringify(allTcIds))}">${ICON.refresh()}Rerun all</button>` : ''}
      </div>` : '';

    return `<div class="tf-run-header">
      <div class="tf-run-header-top">
        <span class="tf-app-tile lg" data-app="${run.app}">${am.glyph}</span>
        <div style="flex:1;">
          <div class="tf-run-header-name"><span class="tf-run-header-appname">${am.name}</span><span class="tf-run-header-meta">${platformLabel(run.platform)} · ${escapeHtml(fmtVersion(run.version))}${run.buildNumber ? ' · build #' + escapeHtml(run.buildNumber) : ''}</span></div>
          <div class="tf-run-header-req">Requested by <span style="color:var(--tx2);">${escapeHtml(run.requestedByEmail)}</span></div>
        </div>
        <span class="tf-badge" data-st="${st}"><span class="tf-badge-dot ${st === 'running' ? 'tf-live-dot' : ''}"></span>${stText}</span>
      </div>
      <div class="tf-divider"></div>
      <div class="tf-meta-grid">
        ${meta('Device', escapeHtml(run.device ? run.device.model : '—'))}
        ${meta('Serial', escapeHtml(run.device ? run.device.serial : '—'))}
        ${meta('Duration', durSec != null ? fmtDur(durSec) : '—')}
        ${meta('Passed', `<span style="color:var(--ok);">${passCount}</span>${failCount > 0 ? ` <span style="color:var(--bad);">· ${failCount} failed</span>` : ''} <span style="color:var(--tx3);">/ ${run.totalTcs || tcSummary.length}</span>`)}
        ${meta('Flagged', flagCount > 0 ? `<span style="color:var(--warn);">${flagCount}</span>` : '0')}
        ${meta('Requested', escapeHtml(fmtRelative(toMillis(run.requestedAt))))}
      </div>
      ${actionsHtml}
    </div>`;
  }

  function breakdownHtml(run, tcResults) {
    const resultsById = {}; tcResults.forEach((t) => { resultsById[t.id] = t; });
    const flaggedShots = [];
    tcResults.forEach((t) => (t.screenshots || []).forEach((s) => { if (s.flagged) flaggedShots.push({ tc: t.id, ...s }); }));

    let flaggedSection = '';
    if (flaggedShots.length) {
      flaggedSection = `<div class="tf-flagged-banner">
        <div class="tf-flagged-head">${ICON.flag('var(--warn)', 16)}<span class="tf-flagged-title">${flaggedShots.length} flagged ${flaggedShots.length === 1 ? 'screenshot' : 'screenshots'}</span><span class="tf-flagged-sub">worth a human glance — not a hard failure</span></div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${flaggedShots.map((s) => `<div class="tf-flagged-shot"><span class="tf-flagged-tc">${s.tc}</span><div><span class="tf-flagged-name">${escapeHtml(s.name)}</span><div class="tf-flagged-reason">Content-dependent element — captured on device, kept locally by the agent.</div></div></div>`).join('')}
        </div></div>`;
    }

    const rows = (run.tcSummary || []).map((tcSum) => {
      const t = resultsById[tcSum.tcId] || {};
      const { id, name } = parseTc(tcSum.tcId);
      const displayName = t.name && !/^TC-/i.test(t.name) ? t.name : name;
      const key = run.id + '|' + tcSum.tcId;
      const isOpen = !!state.expanded[key];
      const shots = t.screenshots || [];
      const shotHtml = shots.map((s) => `<div class="tf-shot-row">${s.flagged ? ICON.flag('var(--warn)') : ICON.image()}<span class="tf-shot-name ${s.flagged ? 'flagged' : ''}">${escapeHtml(s.name)}</span>${s.flagged ? `<span class="tf-badge sm" data-st="flagged">flagged</span>` : ''}</div>`).join('');
      const dur = t.startedAt && t.finishedAt ? fmtDur((t.finishedAt - t.startedAt) / 1000) : '';
      const detail = isOpen ? `<div class="tf-detail-body">
          ${t.errorMessage ? `<div style="margin:14px 0;"><div class="tf-error-label">Error</div><pre class="tf-error-block">${escapeHtml(t.errorMessage)}</pre></div>` : ''}
          ${shots.length ? `<div style="margin-top:14px;"><div class="tf-shots-label">Screenshots · ${shots.length}</div>${shotHtml}</div>` : ''}
        </div>` : '';
      return `<div class="tf-detail-row">
        <div class="tf-row-btn tf-detail-row-head" data-toggle-tc="${key}">
          ${tcStatusIcon(tcSum.status)}
          <span class="tf-tc-id">${id}</span>
          <span class="tf-detail-row-name">${escapeHtml(displayName)}</span>
          ${tcSum.flagCount > 0 ? `<span class="tf-badge sm" data-st="flagged">${ICON.flag('currentColor', 10)} ${tcSum.flagCount}</span>` : ''}
          <span class="tf-badge sm" data-st="${tcSum.status}">${tcSum.status}</span>
          <span class="tf-detail-row-dur">${dur}</span>
          <span class="tf-chevron ${isOpen ? 'open' : ''}">${ICON.chevron()}</span>
        </div>${detail}</div>`;
    }).join('');

    return flaggedSection + `<div class="tf-detail-card">${rows || '<div style="padding:16px;color:var(--tx3);font-size:13px;">No test case results yet.</div>'}</div>`;
  }

  function renderRunDetailBody() {
    const run = state.activeRun;
    const body = document.getElementById('tf-body');
    const live = state.isLiveView;
    const showGrid = live; // log pane + tc progress only shown for the session that just triggered the run

    let gridHtml = '';
    if (showGrid) {
      const expectedIds = state.pendingTcIds || (run.tcSummary || []).map((t) => t.tcId);
      const byId = {}; (run.tcSummary || []).forEach((t) => { byId[t.tcId] = t; });
      const liveTcs = expectedIds.map((tcId) => {
        const s = byId[tcId];
        const { id, name } = parseTc(tcId);
        return { tcId, id, name, status: s ? s.status : 'queued', flagCount: s ? s.flagCount : 0, dur: '' };
      });
      const doneCount = liveTcs.filter((t) => t.status === 'passed' || t.status === 'failed').length;
      gridHtml = `<div class="tf-live-grid">
        <div class="tf-log-pane">
          <div class="tf-log-header">
            <div class="tf-traffic-lights"><span class="tf-traffic-light" style="background:#ff5f57;"></span><span class="tf-traffic-light" style="background:#febc2e;"></span><span class="tf-traffic-light" style="background:#28c840;"></span></div>
            <span class="tf-log-title">maestro · ${escapeHtml(run.device ? run.device.serial : '—')}</span>
            <div style="flex:1;"></div>
            <span class="tf-badge sm" data-st="${run.status}"><span class="tf-badge-dot ${run.status === 'running' ? 'tf-live-dot' : ''}"></span>${run.status}</span>
          </div>
          <div class="tf-log-body" id="log-body">
            ${state.activeLogs.map((l) => `<div class="tf-log-line"><span class="tf-log-tc">${escapeHtml(l.tcId || '')}</span><span class="tf-log-text">${escapeHtml(l.line)}</span></div>`).join('') || '<div style="color:var(--tx3);">Waiting for the agent to start streaming…</div>'}
            ${['queued', 'claimed', 'running'].includes(run.status) ? `<div class="tf-log-line"><span class="tf-caret" style="color:var(--accent);">▍</span></div>` : ''}
          </div>
        </div>
        <div class="tf-card" style="padding:15px;">
          <div class="tf-sidebar-head"><div class="tf-eyebrow sm">Test cases</div><div style="font-family:var(--mono);font-size:11.5px;color:var(--tx3);">${doneCount}/${liveTcs.length}</div></div>
          <div class="tf-tc-progress-list">
            ${liveTcs.map((t) => {
              const step = t.status === 'running' ? lastLogLineFor(t.tcId) : null;
              return `<div>
                <div class="tf-tc-progress-row ${t.status === 'running' ? 'running' : ''}">
                  ${tcStatusIcon(t.status)}<span class="tf-tc-id">${t.id}</span><span class="tf-tc-progress-name">${escapeHtml(t.name)}</span>
                  ${t.flagCount > 0 ? `<span class="tf-badge sm" data-st="flagged">${ICON.flag('currentColor', 10)} ${t.flagCount}</span>` : ''}
                </div>
                ${step ? `<div class="tf-current-step">${escapeHtml(step)}</div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
    }

    const done = !['queued', 'claimed', 'running'].includes(run.status);

    body.innerHTML = `<div class="tf-page">
      <div class="tf-back-link" data-nav="history">${ICON.back()}${live ? 'All runs' : 'Back to history'}</div>
      ${runHeaderHtml(run)}
      ${gridHtml}
      ${(!live || done) ? `<div style="margin-top:${live ? '26' : '22'}px;">${live ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;"><div style="font-family:var(--ui);font-weight:700;font-size:16px;">Run detail</div><div style="height:1px;flex:1;background:var(--border);"></div></div>` : ''}${breakdownHtml(run, state.activeTcResults)}</div>` : ''}
    </div>`;

    document.querySelectorAll('[data-nav]').forEach((el) => { el.onclick = () => { state.view = el.dataset.nav; if (state.pollTimer) clearInterval(state.pollTimer); render(); }; });
    document.querySelectorAll('[data-toggle-tc]').forEach((el) => {
      el.onclick = () => { const k = el.dataset.toggleTc; state.expanded[k] = !state.expanded[k]; renderRunDetailBody(); };
    });
    const cancelBtn = document.querySelector('[data-action="cancel-run"]');
    if (cancelBtn) cancelBtn.onclick = async () => {
      cancelBtn.disabled = true;
      try { await api(`runs/${run.id}`, { method: 'PATCH', body: { action: 'cancel' } }); await refreshRunDetail(); }
      catch (err) { alert(err.message); cancelBtn.disabled = false; }
    };
    document.querySelectorAll('[data-action="rerun-run"]').forEach((el) => {
      el.onclick = async () => {
        el.disabled = true;
        try {
          const tcIds = JSON.parse(el.dataset.tcids || '[]');
          const data = await api('runs', { method: 'POST', body: { agentId: run.agentId, app: run.app, platform: run.platform, version: run.version, tcIds } });
          openRun(data.runId, { live: true, pendingTcIds: tcIds });
        } catch (err) { alert(err.message); el.disabled = false; }
      };
    });
    const logBody = document.getElementById('log-body');
    if (logBody) logBody.scrollTop = logBody.scrollHeight;
  }

  // ── History ──────────────────────────────────────────────────────────────
  async function renderHistory() {
    renderShell(`<div class="tf-page wide">Loading history…</div>`);
    let runs = [];
    try {
      const data = await api('runs?limit=200');
      runs = data.runs || [];
    } catch (err) {
      const body = document.getElementById('tf-body');
      if (body) body.innerHTML = `<div class="tf-page wide"><div class="tf-card tf-error">${escapeHtml(err.message)}</div></div>`;
      return;
    }

    const q = state.histSearch.trim().toLowerCase();
    const filtered = runs.filter((r) =>
      (state.fApp === 'all' || r.app === state.fApp) &&
      (state.fPlatform === 'all' || r.platform === state.fPlatform) &&
      (state.fStatus === 'all' || r.status === state.fStatus) &&
      (!q || `${r.requestedByEmail} ${r.device ? r.device.model : ''} ${r.version} ${r.app} ${r.buildNumber || ''}`.toLowerCase().includes(q))
    );

    const filterGroup = (key, opts) => `<div class="tf-filter-group">${opts.map((o) => `<div class="tf-filter-opt ${state[key] === o.v ? 'active' : ''}" data-filter="${key}" data-value="${o.v}">${o.l}</div>`).join('')}</div>`;

    document.getElementById('tf-body').innerHTML = `<div class="tf-page wide">
      <div style="margin-bottom:20px;"><h1 class="tf-page-title">Run history</h1><div class="tf-page-sub">Every run across the team — who tested what, when, on which build.</div></div>
      <div class="tf-hist-filters">
        <div class="tf-search-wrap"><span class="tf-search-icon">${ICON.search()}</span><input class="tf-search-input" id="hist-search" placeholder="Search tester, device, version…" value="${escapeHtml(state.histSearch)}" /></div>
        ${filterGroup('fApp', [{ l: 'All apps', v: 'all' }, { l: 'hoichoi', v: 'hoichoi' }, { l: 'sooper', v: 'sooper' }])}
        ${filterGroup('fPlatform', [{ l: 'All OS', v: 'all' }, { l: 'Android', v: 'android' }, { l: 'iOS', v: 'ios' }])}
        ${filterGroup('fStatus', [{ l: 'Any status', v: 'all' }, { l: 'Passed', v: 'passed' }, { l: 'Failed', v: 'failed' }])}
        <div style="flex:1;"></div>
        <div class="tf-hist-count">${filtered.length} runs</div>
      </div>
      ${filtered.length ? `<div class="tf-table">
        <div class="tf-table-head"><div>App / Platform</div><div>Version</div><div>Tester</div><div>Device</div><div>Status</div><div>Duration</div><div>Requested</div></div>
        ${filtered.map((r) => {
          const durSec = runDurationSec(r);
          const flagCount = (r.tcSummary || []).reduce((a, t) => a + (t.flagCount || 0), 0);
          return `<div class="tf-row-btn tf-table-row" data-open-run="${r.id}" data-live="0">
            <div class="tf-table-app-cell"><span class="tf-app-tile" data-app="${r.app}">${APP_META[r.app].glyph}</span><div><div class="tf-table-app-name">${APP_META[r.app].name}</div><div class="tf-table-app-platform">${platformLabel(r.platform)}</div></div></div>
            <div class="tf-table-version">${escapeHtml(fmtVersion(r.version))}<div class="tf-table-build">${r.buildNumber ? '#' + escapeHtml(r.buildNumber) : ''}</div></div>
            <div class="tf-table-cell-dim">${escapeHtml(r.requestedByEmail)}</div>
            <div style="min-width:0;"><div class="tf-table-device-model">${escapeHtml(r.device ? r.device.model : '—')}</div><div class="tf-table-device-serial">${escapeHtml(r.device ? r.device.serial : '')}</div></div>
            <div><span class="tf-badge sm" data-st="${r.status}">${r.status}</span>${flagCount > 0 ? `<span class="tf-badge sm" data-st="flagged" style="margin-left:5px;">⚑ ${flagCount}</span>` : ''}</div>
            <div class="tf-table-cell-dim">${durSec != null ? fmtDur(durSec) : '—'}</div>
            <div class="tf-table-cell-dim">${escapeHtml(fmtRelative(toMillis(r.requestedAt)))}</div>
          </div>`;
        }).join('')}
      </div>` : `<div class="tf-empty-state lg">
        <div class="tf-empty-icon lg">${ICON.inbox()}</div>
        <div class="tf-empty-title">No runs match these filters</div>
        <div class="tf-empty-body">Trigger one from <span style="color:var(--accent);cursor:pointer;" data-nav="run">Run Test</span>, or clear the filters.</div>
      </div>`}
    </div>`;

    document.getElementById('hist-search').oninput = (e) => { state.histSearch = e.target.value; renderHistory(); };
    document.querySelectorAll('[data-filter]').forEach((el) => { el.onclick = () => { state[el.dataset.filter] = el.dataset.value; renderHistory(); }; });
    document.querySelectorAll('[data-open-run]').forEach((el) => { el.onclick = () => openRun(el.dataset.openRun, { live: el.dataset.live === '1' }); });
    document.querySelectorAll('[data-nav]').forEach((el) => { el.onclick = () => { state.view = el.dataset.nav; render(); }; });
  }

  // ── router ───────────────────────────────────────────────────────────────
  function render() {
    if (!state.token) return renderLogin();
    if (state.mustChange) return renderSetPassword();
    if (state.view === 'history') return renderHistory();
    if (state.view === 'run-detail') return renderRunDetail();
    return renderRun();
  }

  render();
})();

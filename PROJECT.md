# TestFlow

Internal QA testing platform for **hoichoi** (Bengali OTT) and **sooper**
(vertical micro-drama), built by Boloram (QA Tester and CS Team Lead at
hoichoi) using Maestro + Claude Code. Successor to QAForge, which was a
single-app, single-machine, CLI-only version of this same idea.

## Goal

Let any tester on the team connect their own phone over ADB, pick
`app → platform → version`, run the relevant Maestro regression suite, and
see complete shared history afterward: who tested, when, which build, what
flagged, what failed, and why — instead of manual regression testing or
one person's local Maestro CLI runs.

## Architecture

A browser can't talk to ADB/USB devices directly, so this is three pieces,
not one website:

1. **Flows** (`flows/{app}/{platform}/{version}/*.yaml`) — Maestro YAML test
   suites, authored directly (with Claude Code's help) and committed to this
   repo, exactly like QAForge's flows were. Not uploaded through the UI.
2. **Runner Agent** (`runner-agent/`) — a small Node.js process each tester
   runs locally on their own PC/Mac, next to a phone on USB. It `git pull`s
   this repo, detects connected devices, executes Maestro flows, and reports
   everything back over HTTP. It never holds a Firebase credential.
3. **Dashboard + API** (`/`, `api/`) — a vanilla-JS SPA + Vercel serverless
   functions, deployed to Vercel. The API is the only thing holding the
   Firebase Admin service-account key; it's the sole path to Firestore for
   both the browser and every runner agent.

Own Vercel *project* (same team as BridgeCx is fine — Vercel's 12-function
Hobby cap is per-deployment, not account-wide, confirmed against Vercel's own
docs) and its own, fully separate Firebase project (`testflow-9ebcf`). The
Firebase separation is a harder requirement than the Vercel one: it's about
never putting a key with access to production hoichoi data into TestFlow's
env vars. Only the *patterns* (`lib/auth.js`'s session/password scheme,
`lib/firebase.js`'s base64 service-account init) are reused from BridgeCx,
not any infrastructure.

**No Firebase Storage in v1.** Storage requires the Blaze (pay-as-you-go)
plan even for free-tier usage, and reusing an existing production Firebase
project's Storage bucket to dodge that billing step was considered and
rejected — a service-account key generally grants access to everything in
that project, not just one bucket/folder, which would put production data
one leaked-key or bug away from TestFlow. So for now, Maestro's screenshots
(including `FLAG-`-prefixed ones) stay on the tester's own machine; the
dashboard lists their filenames/flags but can't display the images. Revisit
by giving `testflow-9ebcf` its own Blaze billing once that's worth doing.

## Status

Phase 1 (scaffold) built and live: GitHub repo, Vercel project
(`hoichoi-cx/test-flow`), Firebase project (`testflow-9ebcf`, Firestore
enabled), `SESSION_SECRET`/`DEFAULT_PASSWORD` env vars set. All 5 API
functions (`auth`, `agents`, `runs`, `runs/[id]`, `runs/[id]/logs` —
screenshot upload was removed along with Storage), runner agent, and a
dashboard matching the Claude Design handoff (`design_handoff_testflow_qa_dashboard`).

**Test suite history — important, easy to get wrong:** the flows QAForge
originally wrote were tested against hoichoi Android **v3.1.36** ("common
UI, first build" — now deprecated), and live at
`flows/hoichoi/android/3.1.36/`. Do not reuse those files for a current build
by just renaming the folder — Maestro YAML is hardcoded to specific element
text/ids/coordinates, so even a small UI change silently breaks an old flow.
`flows/hoichoi/android/4.0.2/` now has a real, freshly-authored **TC-01**
(`TC-01-app-overview-navigation-search-login-language-settings.yaml`),
written directly against that build's actual UI — not yet run end-to-end
through the website (that needs the runner agent live, see below). TC-02
onward for 4.0.2 still need authoring, same as the rest of the suite.

**Not yet done / needs a real deploy to verify:**
- Finish authoring TC-02 through TC-08 for 4.0.2 (or however many end up
  making sense for the current UI). TC-01 exists and passes/fails for real.
- iOS support in the runner agent (idb/simctl) — needs a Mac, materially more
  work than Android, not a bolt-on.
- sooper's flows — none exist yet; same `flows/sooper/{platform}/{version}/`
  layout as hoichoi once authored. sooper's package id(s) also need filling
  into `runner-agent/agent.js`'s `APP_PACKAGE_IDS` map.
- Mac/Linux autostart for the runner agent (the Windows Task Scheduler
  installer is done; other OSes still use `npm start` or a hand-rolled
  launchd/systemd unit).
- Maestro's stdout is streamed as the raw log for now — no structured
  per-step JUnit parsing yet; confirm the CLI's actual output format against
  a real run before building anything that depends on its exact shape.

**Done and verified against the real device (as of the current build):**
- End-to-end loop works: website → agent → OnePlus (`ef6f7c89`) → website,
  with real pass/fail results and clean live logs.
- Stop button cancels a run in ~1-2s and kills the whole Maestro process tree
  (not just the `cmd.exe` wrapper) on Windows.
- Rerun (failed-only default, or full suite) from any finished run.
- Stuck-run handling: agent self-heals its own orphaned runs on restart, plus a
  15-min passive staleness sweep; interrupted runs show `Cancelled`, never a
  false `Failed`.
- Runner agent runs as a **hidden Windows background process** via Task
  Scheduler (`runner-agent/install-agent-autostart.ps1`): starts at logon,
  survives reboots, and a 2-min repeating trigger auto-relaunches it within
  ~2 min if it ever dies (crash-recovery verified by killing the process).
  Deliberately at-logon in the user session, NOT a session-0 Windows Service,
  because session 0 can't reliably see USB/ADB devices.

## Test Devices

- Primary: OnePlus Nord CE 3 Lite 5G, Android 15, serial `ef6f7c89`
- Secondary: Google Pixel 6 Pro, Android 16

See `CLAUDE.md` for the Maestro YAML conventions that still apply — they carry
over unchanged from QAForge.

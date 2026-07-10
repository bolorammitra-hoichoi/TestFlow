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
`flows/hoichoi/android/3.1.36/`. There is currently **no flow suite for the
actual current hoichoi Android build** — those need to be authored fresh.
This isn't optional busywork: Maestro YAML is hardcoded to specific element
text/ids/coordinates, so even a small UI change between 3.1.36 and today
will silently break these old flows if run against a current build. Do not
reuse the 3.1.36 files by just renaming the folder — write new ones against
the real current UI (the Maestro MCP tools — `list_devices`,
`inspect_screen`, `run` — are available for this). Once written, they go in
a new `flows/hoichoi/android/{real-version-number}/` folder.

**Not yet done / needs a real deploy to verify:**
- Set `FIREBASE_SERVICE_ACCOUNT_B64` in Vercel from `testflow-9ebcf`'s
  service account, then do a real end-to-end run against a connected phone.
- Author flows for the current hoichoi Android build (see above) — 3.1.36 is
  the only version with runnable flows right now.
- iOS support in the runner agent (idb/simctl) — needs a Mac, materially more
  work than Android, not a bolt-on.
- sooper's flows — none exist yet; same `flows/sooper/{platform}/{version}/`
  layout as hoichoi once authored. sooper's package id(s) also need filling
  into `runner-agent/agent.js`'s `APP_PACKAGE_IDS` map.
- Packaging the runner agent as a background/tray process instead of a
  terminal window a tester has to keep open.
- Retry/rerun affordance for flaky Maestro runs.
- Maestro's stdout is streamed as the raw log for now — no structured
  per-step JUnit parsing yet; confirm the CLI's actual output format against
  a real run before building anything that depends on its exact shape.

## Test Devices

- Primary: OnePlus Nord CE 3 Lite 5G, Android 15, serial `ef6f7c89`
- Secondary: Google Pixel 6 Pro, Android 16

See `CLAUDE.md` for the Maestro YAML conventions that still apply — they carry
over unchanged from QAForge.

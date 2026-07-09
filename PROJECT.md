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
   Firebase Admin service-account key; it's the sole path to Firestore/Storage
   for both the browser and every runner agent.

Own Vercel account and own Firebase project — intentionally separate from
the user's other project, [BridgeCx](../BridgeCx), whose account is already
near the Hobby plan's 12-serverless-function cap. Only the *patterns*
(`lib/auth.js`'s session/password scheme, `lib/firebase.js`'s base64
service-account init) are reused, not the infrastructure itself.

## Status

Phase 1 (scaffold) built: repo layout, auth, Firestore data model, all 6 API
functions, runner agent skeleton, dashboard skeleton, QAForge's existing
flows moved into the new layout under `flows/hoichoi/android/v-current/`
(rename that folder to the actual hoichoi build version it was tested
against).

**Not yet done / needs a real deploy to verify:**
- Create the actual Vercel project + Firebase project, wire up env vars
  (`FIREBASE_SERVICE_ACCOUNT_B64`, `FIREBASE_STORAGE_BUCKET`, `SESSION_SECRET`,
  `DEFAULT_PASSWORD`), and do a real end-to-end run against a connected phone.
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

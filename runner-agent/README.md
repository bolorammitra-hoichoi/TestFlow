# TestFlow Runner Agent

Runs on your own PC/Mac, next to a phone connected over USB. It's what actually
drives ADB/Maestro — the website itself can't touch your USB devices, so this
process bridges the two: it reports your connected devices to the dashboard,
picks up runs you (or a teammate) trigger from the browser, executes the
Maestro YAML flows, and streams logs/results/screenshots back.

## One-time setup

1. Install [Maestro CLI](https://maestro.mobile.dev/) and ADB, same as for QAForge today.
2. Install [Node.js](https://nodejs.org/) 18+.
3. From this folder: `npm install` (no dependencies yet beyond Node itself, but keeps the door open).
4. Copy `.env.example` to `.env` and fill in:
   - `TESTFLOW_API_URL` — the deployed TestFlow website's URL
   - `TESTFLOW_EMAIL` / `TESTFLOW_PASSWORD` — your TestFlow login (must be `@hoichoi.tv`)
   - `TESTFLOW_REPO_DIR` — path to a local clone of this same TestFlow repo (the agent `git pull`s it before every heartbeat so it always runs the latest YAMLs)

## Running

```
npm start
```

Leave it running in a terminal while you're testing. It heartbeats every 10s
(configurable) — the dashboard shows your machine as "offline" a few seconds
after you close this window, so a dead agent is obvious rather than silently
looking connected.

## Known limits (v1)

- Android only — iOS (idb/simctl) isn't wired up yet, needs a Mac.
- Runs one TC at a time, one run at a time per agent — if two run requests land on the same agent, the second waits until the first finishes.
- Must be run manually in a terminal for now; packaging it as a background/tray app is a later improvement (see PROJECT.md).

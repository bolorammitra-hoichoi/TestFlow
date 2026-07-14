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

### Recommended: install it to auto-start in the background (Windows)

```
powershell -ExecutionPolicy Bypass -File .\install-agent-autostart.ps1
```

This registers a Task Scheduler task that runs the agent **silently in the
background**, starting at every logon and surviving reboots — no terminal
window to keep open. Output goes to `agent.log` in this folder if you ever
need to check it, and the dashboard shows your machine online/offline either
way. To remove it: `powershell -ExecutionPolicy Bypass -File .\uninstall-agent-autostart.ps1`

How it stays alive:
- Runs at logon in **your** session (not a Windows Service in session 0) — that's
  what lets it see USB/ADB devices exactly like you do; a session-0 service can't.
- A 2-minute repeating check relaunches it automatically if the process ever
  dies, so a crash self-recovers within ~2 min.
- If it comes back after being interrupted mid-run, it auto-cancels its own
  orphaned run rather than leaving it stuck "running" forever.

### Or run it manually in a terminal

```
npm start
```

Fine for quick one-offs; the window has to stay open, and closing it stops the
agent (the dashboard will show your machine offline within ~45s).

## One-time setup, continued

After `.env` is filled in, also run `npm install` once (currently no external
deps, but it's the habit). Then use one of the two run options above.

## Known limits (v1)

- Android only — iOS (idb/simctl) isn't wired up yet, needs a Mac.
- Runs one TC at a time, one run at a time per agent — if two run requests land on the same agent, the second waits until the first finishes.
- Windows autostart only so far (the install script is PowerShell/Task Scheduler). Mac/Linux still use `npm start` in a terminal, or a launchd/systemd unit you set up yourself.

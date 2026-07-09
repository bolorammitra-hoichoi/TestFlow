# TestFlow

Internal QA testing platform for hoichoi and sooper — website + runner agent
wrapped around a Maestro-based YAML test suite. See `PROJECT.md` for the full
architecture and status.

## Repo layout

- `flows/{app}/{platform}/{version}/*.yaml` — Maestro test flows. `app` is
  `hoichoi` or `sooper`, `platform` is `android` or `ios`. Every TC file for a
  given version sits in the same folder as that version's `startup-check.yaml`
  (Maestro resolves `runFlow: startup-check.yaml` relative to the calling
  file's directory — don't split them across folders).
- `api/*.js` — Vercel serverless functions. Deliberately consolidated (one
  file dispatches multiple actions/methods) to stay well under the Vercel
  Hobby plan's 12-function cap — see PROJECT.md for why. Only these files may
  `require('firebase-admin')` — the Firebase Admin key must never reach a
  runner agent or the browser.
- `lib/auth.js`, `lib/firebase.js` — session tokens (signed HMAC, no JWT lib),
  scrypt password hashing, and the single Firebase Admin init. Ported from
  the user's other project, BridgeCx — same pattern, separate Firebase
  project and Vercel account.
- `runner-agent/` — Node.js process a tester runs locally. Talks to `api/*.js`
  over HTTP with a session token, same as the browser. Never touches
  Firestore/Storage directly.
- `index.html` / `app.js` / `app.css` — the dashboard. Flat vanilla JS, no
  build step, no framework — matches BridgeCx's style.

## Adding a new app/platform/version

Just add a folder: `flows/{app}/{platform}/{version}/`, drop in
`startup-check.yaml` + `TC-*.yaml` files. The runner agent scans this on every
heartbeat and reports it to the dashboard — no manifest file to hand-edit, no
upload step.

## Critical YAML Rules (apply to every file — unchanged from QAForge)

1. Every file starts with `appId: <package id>` then `---`
2. Every file ends with `- stopApp`
3. Never use `clearState` — blocked by Android 15 permissions
4. Every TC calls `- runFlow: startup-check.yaml` right after `launchApp` +
   `waitForAnimationToEnd`. This reusable flow handles Allow/Close/Later
   popups and relaunches the app if Home isn't visible.

## Player/Playback Screen Rule (CRITICAL — most common bug source)

**On the player/playback screen, NEVER add `waitForAnimationToEnd` or any wait
before an `assertVisible`.** The player controls auto-hide after a few
seconds of inactivity — any delay causes the next assert to fail because the
UI has vanished.

Correct pattern on player screens:
```yaml
- tapOn:
    point: "50%,50%"
- assertVisible: "fastForward"
```

Wrong pattern (will fail intermittently):
```yaml
- tapOn:
    point: "50%,50%"
- waitForAnimationToEnd
- assertVisible: "fastForward"
```

- `tapOn: point: "50%,50%"` = center tap, wakes player controls
- `tapOn: point: "52%,80%"` = opens Playback Settings panel (Subtitles/Speed/Video Quality)

Non-player screens (Account, Search, Downloads, etc.) can use normal `waitForAnimationToEnd`.

## Subtitles Handling (content-dependent behavior)

Subtitles behave two different ways depending on content:
- **Single-language content:** tapping `Subtitles (Off)` toggles directly to `Subtitles (English)`
- **Multi-language content:** tapping `Subtitles (Off)` opens a popup with `Off` / `English` / `Bengali` options

Always use this pattern — tap first, then conditionally handle the popup if it appears:
```yaml
- tapOn: "Subtitles (Off)"
- runFlow:
    when:
      visible: "English"
    commands:
      - tapOn: "English"
```

After any subtitle change, assert conditionally for whichever state may be showing (Off/English/Bengali) rather than a single hard assert — any of the three is valid depending on content.

## Optional/Content-Dependent Elements — Flag, Don't Fail

Some elements (video quality tiers like Low, Continue Watching row, Watchlist row) may legitimately be absent depending on account state or content. For these:
- If visible → assert normally
- If not visible → take a screenshot prefixed `FLAG-` and continue WITHOUT failing the test

```yaml
- runFlow:
    when:
      visible: "Low"
    commands:
      - assertVisible: "Low"
- runFlow:
    when:
      notVisible: "Low"
    commands:
      - takeScreenshot: "FLAG-low-quality-not-available"
```

The dashboard scans for `FLAG-` prefixed screenshots and surfaces them as warnings, not failures — see `api/runs/[id]/screenshot.js`.

## Key Maestro Syntax Reference

- Coordinate tap: `tapOn: { point: "50%,50%" }` — MUST be nested under `point:`. `tapOn: "50%,50%"` is wrong and gets treated as a text search.
- Airplane mode: `setAirplaneMode: enabled` / `setAirplaneMode: disabled` (bare string, not `true`/`false`, not nested)
- Long conditional wait: `extendedWaitUntil: { visible/notVisible: <condition>, timeout: <ms> }` — completes as soon as condition is met, does not block for the full timeout. Preferred over `evalScript` with `setTimeout`.
- Regex text match: `tapOn: "~Download S\\d+"` — tilde prefix enables regex
- Login confirmation: `assertNotVisible: "Login / Sign Up"` (reliable across all subscription states)
- Element not visible on screen: nested `runFlow: when: notVisible: "App Logo"` with `tapOn: id: "com.android.systemui:id/back"`, tried up to 3 times

## Device Limit Screen (may appear on login)

Each excess device removal requires TWO taps: `tapOn: text: "Logout" index: 0` (the device row) then `tapOn: "Logout"` (confirmation popup). Nested `runFlow` handles up to 3 excess devices, then `tapOn: "Continue"`.

## Test Credentials (hoichoi)

- Phone: `9876543210` / OTP `2121`
- Email: `test@test.com` / OTP `2121`
- Google: `hoichoi359@gmail.com`

sooper credentials: not set up yet — add here once sooper flows exist.

## When Debugging a Failed Test

1. Ask for the exact error message/screenshot from Maestro Studio, CLI output, or the dashboard's Run Detail page.
2. Check if it's a YAML syntax error (parsing failed) vs. a runtime assertion failure.
3. For assertion failures on the player screen, the first suspect is always an unwanted wait causing the screen to sleep.
4. For "Element not found" on a coordinate-based tap written as `tapOn: "X%,Y%"`, the fix is almost always to nest it under `point:`.
5. If the failure only shows up through the website (not a direct `maestro test` run), check the runner agent's terminal output first — it's the thing actually invoking Maestro and streaming logs up.

## Website/agent conventions

- `api/*.js` files require a valid session (`auth.verify(auth.bearer(req))`) on every request except `auth.js`'s `login` action — copy that check, don't skip it.
- Firebase Admin SDK (`lib/firebase.js`) is required **only** inside `api/*.js`. If you find yourself wanting to `require('firebase-admin')` in `runner-agent/` or `app.js`, that's a sign the design is being violated — route it through an API call instead.
- Keep `api/` to a small number of consolidated files (dispatch on method/`action`, not one file per operation) — see PROJECT.md for the Vercel function-count reasoning.

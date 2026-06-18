# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Claude Spark** — a macOS desktop mascot for the **Claude Code CLI**. It's an Electron app showing a transparent, always-on-top, click-through window with the Claude Code logo that animates in response to Claude Code lifecycle events (received via hooks) and to the user's typing cadence. Unofficial / fan-made; not affiliated with Anthropic.

## Commands

```bash
npm start              # run in dev (electron .)
npm run dist           # build universal .dmg + .zip into release/, then copy the .dmg to repo root (postdist)
npm run dist:signed    # same, signed + notarized (needs SIGN=1 creds — see SIGNING.md)
npm run pack           # fast unsigned .app into release/mac-*/ (no installer) — use to validate the build
npm run icon           # regenerate build/icon.icns + icon.png from build/icon.svg (needs `brew install librsvg`)
bash docs/src/make-docs.sh   # regenerate README marketing images from docs/src/*.svg (needs rsvg-convert)
```

There are **no tests, linter, or build step for the app code** — `main.js`/`renderer.js`/`preload.js` ship as-is. "Verifying" means launching the app and exercising it (see below).

### Verifying changes without a real Claude Code session

The app exposes a localhost server on **port 47615**. With the app running (`npm start`):

```bash
# simulate any Claude Code event:
curl -s -X POST "http://127.0.0.1:47615/event?term=Apple_Terminal" -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"Stop","session_id":"s1","cwd":"/x/myproject"}'
# preview the typing animation (no Accessibility permission needed):
curl "http://127.0.0.1:47615/simulate-typing?n=60&interval=70"
# inspect tracked running sessions + uptime:
curl http://127.0.0.1:47615/sessions
```

In **dev** (`!app.isPackaged`), renderer `console` output at warn/error level is forwarded to the terminal — watch `npm start`'s stdout (or `/tmp/claude-spark.log` if launched detached) for `[renderer]` lines. The renderer has no other debug surface.

## Architecture

Event-driven, three layers connected by a local HTTP server + Electron IPC:

```
Claude Code hooks --curl POST JSON--> HTTP server (main.js, :47615) --IPC--> renderer.js (animation state machine)
global keyboard (uiohook-napi, timing only) ----------------------------------^
```

- **`main.js`** (Electron main) is the hub: creates the transparent window; runs the `http` server (`/event`, `/health`, `/sessions`, `/simulate-typing`); loads/persists config + state; builds the right-click `Menu`; runs the global keyboard monitor; installs/removes Claude Code hooks; tracks running sessions. It forwards every event to the renderer via `win.webContents.send`.
- **`preload.js`** is the only bridge (contextIsolation on, nodeIntegration off). Every renderer→main or main→renderer channel must be declared here. Adding a feature that needs new IPC means editing all three of main.js, preload.js, renderer.js.
- **`renderer.js`** is a pure state machine: maps each event to an animation class on `#character`, a speech-bubble, an optional sound, and a native `Notification`. It owns the typing-speed→color logic, the escalating "nudge" timer, daily-stats (localStorage), and drag handling. Visual states live as `.state-*` CSS classes in `style.css`; the character is the inline SVG logo in `index.html`.

### Key conventions & gotchas

- **Port 47615** is deliberate — 8765 collided with another local app. It is hardcoded in `main.js`, `hooks.snippet.json`, the installed hooks in `~/.claude/settings.json`, `start.sh`, and the README. Change all of them together.
- **Claude Code integration is via hooks** the app writes into `~/.claude/settings.json` (events: Stop, StopFailure, Notification, UserPromptSubmit, SubagentStop, PreToolUse, SessionStart, SessionEnd). The hook command is just `curl -s --max-time 1 ...` so it never blocks/errors Claude Code when the app is down. Install/remove logic lives in `main.js` (`installHooks`/`removeHooks`, detected by the `127.0.0.1:47615` marker); reference copy in `hooks.snippet.json`.
- **Config vs state paths depend on packaging**: `WRITABLE_DIR = app.isPackaged ? app.getPath('userData') : __dirname`. In dev you edit the repo's `config.json`; the installed app uses `~/Library/Application Support/Claude Spark/`. `config.json` = user prefs (defaults in `DEFAULT_CONFIG`); `state.json` = app-written runtime (position, mute, DND, animMode, firstRunDone).
- **Privacy invariant for keyboard**: the `uiohook-napi` `keydown` handler must only forward *that* a key was pressed (timing), never *which* key. Do not pass keycodes to the renderer.
- **Native module packaging**: `uiohook-napi` is native — it must stay in both `files` and `asarUnpack` in `electron-builder.config.js`, or the `.node` binary can't load from inside the asar. It ships N-API prebuilds for darwin x64+arm64, so the universal build needs no rebuild.
- **Accessibility permission** is required for typing reactions (`systemPreferences.isTrustedAccessibilityClient`). The app prompts on first run; "Retry typing access" in the menu re-attempts.
- **macOS Spotlight**: an installed copy must be at `/Applications` AND registered with LaunchServices to appear in Spotlight. `spotlight-fix.sh` reinstalls from the latest build and re-registers.

## Build & distribution

- Built with **electron-builder**; config is `electron-builder.config.js` (NOT the `package.json` `build` field). It's env-gated: unsigned by default, signed + notarized when `SIGN=1` and Apple credentials are present. Entitlements: `build/entitlements.mac.plist`. Full signing runbook: **SIGNING.md**.
- Source lives at **github.com/jeremyperson/claude-spark** (public). Releases are distributed as GitHub **release assets** (`gh release create <tag> --repo jeremyperson/claude-spark "<file>.dmg"`) — the .dmg is ~168 MB, over GitHub's 100 MB file limit, so it is never committed (`.gitignore` excludes `*.dmg`/`*.zip`/`release/`/`node_modules/`).
- **Bumping the version** touches three places that must agree: `package.json` `version`, and in `README.md` the hard-coded download-button URL + tag (the release badge auto-tracks "latest"). Build artifacts are named from `package.json` version, so re-run `npm run dist` after bumping.
- README marketing images (`docs/*.png`) are generated from SVG sources in `docs/src/` via `rsvg-convert`; emoji don't render in rasterized SVG (use plain text in images, real emoji only in markdown body).

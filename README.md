# Claude Spark ✦

An animated Claude Code mascot that **lives on your macOS desktop**. The official Claude
Code logo floats in a corner, bobs and blinks while idle, and reacts to what Claude Code is
doing — with project context, native notifications, nudges, and more.

## Reactions

| Claude Code event | Hook | Reaction |
|---|---|---|
| You send a prompt | `UserPromptSubmit` | Pulses + tilts, "On it…" |
| Long task (>2 min) | (derived) | Switches to a slower "Still working…" grind |
| A subagent finishes | `SubagentStop` | Quick nod, "Subagent done" |
| Claude needs you | `Notification` | Bounces + glow + chime + native banner; **escalating nudge** until you respond |
| A tool runs | `PreToolUse` | Subtle micro-pulse + tool label (off by default) |
| Claude finishes | `Stop` | Spins + sparkles, **"project · done in 2m14s"**, chime + native banner |
| A turn fails | `StopFailure` | Red shake, "Something broke ⚠️" |

## Typing reactions ⌨️

When you type **anywhere**, the mascot bounces per keystroke and puffs little floating
keycaps — and **heats up with your speed**: coral when slow → orange → glowing red when
you're flying. (Schemes: `heat`, `cool`, `rainbow` in `config.json` → `keyboard.scheme`.)

- **Privacy:** this measures **keystroke *timing* only** — it never reads, stores, or sends
  *which* keys you press. The code ignores the keycode entirely.
- **Permission:** macOS requires **Accessibility** permission for system-wide key timing.
  On first launch Spark offers to open Privacy & Security → Accessibility; enable
  **Claude Spark** (or, when running from source, **Electron** / your terminal), then
  right-click → **Retry typing access**.
- **Preview without the permission:** `curl "http://127.0.0.1:47615/simulate-typing?n=60&interval=70"`
  fires synthetic keystrokes so you can see the animation. Disable the whole feature via
  `keyboard.enabled: false`.

## Interactions

- **Left-click** → focuses the terminal that needs you (raises the app the session runs in).
- **Drag** → move the mascot anywhere; position is remembered (`state.json`).
- **Right-click** → menu: **running Claude Code instances + per-instance uptime**, Animations
  (Random/Calm + Play), Mute, Do Not Disturb, Reset position, Tasks today, retry typing access,
  Open at login, Open config, Quit. Each running session is listed as `project — 1h 03m`.
- `curl http://127.0.0.1:47615/sessions` returns the running instances + uptime as JSON.
- Badges: 🔇 = muted, 🌙 = Do Not Disturb.

## How it works

```
Claude Code ──hook (curl POST JSON ?term=$TERM_PROGRAM)──▶ 127.0.0.1:47615 ──IPC──▶ animated mascot
(~/.claude/settings.json)                                  (server in Electron main)
```

Hooks use `curl -s --max-time 1`, so if the app isn't running they fail instantly and
**never block or error Claude Code**. The `?term=$TERM_PROGRAM` query tells the app which
terminal each session uses, powering click-to-focus.

## Run it

```bash
cd /Applications/MAMP/htdocs/claudeCLICharacter
npm install        # first time only
npm start          # or ./start.sh (idempotent)
```

## Configuration — `config.json`

User-editable; restart the app after changing. Missing keys fall back to defaults.

| Key | Meaning |
|---|---|
| `corner` | `bottom-right` (default), `bottom-left`, `top-right`, `top-left` — initial position |
| `enabledEvents` | Per-event on/off switches |
| `sounds` | `enabled` + per-state sound file URLs (default: macOS system sounds) |
| `bubbleDurationMs` | How long the speech bubble stays up |
| `nudge` | `{enabled, afterMs, repeatMs, maxRepeats}` — escalating reminder when Claude needs you |
| `longRunAfterMs` | When a running task flips to the "still working" state (default 120000) |
| `toolReactions` | Show per-tool micro-reactions from `PreToolUse` (default `false` — high frequency) |
| `showOnlyDuringSessions` | `{enabled, idleFadeMs}` — fade out when no session is active |

`state.json` is written **by the app** (window position, mute, DND) — don't hand-edit; it's
kept separate so it never clobbers your `config.json`.

## Test without Claude Code

```bash
U="http://127.0.0.1:47615/event?term=Apple_Terminal"
curl -s -X POST "$U" -H 'Content-Type: application/json' -d '{"hook_event_name":"UserPromptSubmit","session_id":"s1","cwd":"/x/zenPayroll"}'
curl -s -X POST "$U" -H 'Content-Type: application/json' -d '{"hook_event_name":"Stop","session_id":"s1","cwd":"/x/zenPayroll"}'
curl -s -X POST "$U" -H 'Content-Type: application/json' -d '{"hook_event_name":"StopFailure"}'
curl -s -X POST "$U" -H 'Content-Type: application/json' -d '{"hook_event_name":"Notification","notification_type":"permission_prompt"}'
```

## Hooks (installed in `~/.claude/settings.json`)

8 events POST to the server: `Stop`, `StopFailure`, `Notification`, `UserPromptSubmit`,
`SubagentStop`, `PreToolUse`, `SessionStart`, `SessionEnd`. The reference copy lives in
`hooks.snippet.json` — merge it manually to reinstall elsewhere.

## Install as a Mac app (for end users)

A packaged `Claude Spark.dmg` is built into `release/`. To install:

1. Open the `.dmg` and drag **Claude Spark** to **Applications**.
2. First launch: because the build is **unsigned**, macOS Gatekeeper will warn. **Right-click
   the app → Open → Open** (only needed once). *(If you later sign + notarize, this step goes away.)*
3. On first run the app asks to **install the Claude Code hooks** into `~/.claude/settings.json`.
   Click *Install hooks*, then restart any open Claude Code sessions.

Once installed, the app is self-contained — it stores `config.json`/`state.json` in
`~/Library/Application Support/Claude Spark/` (right-click → **Open config.json** to edit).
Manage everything from the right-click menu: **Install/Remove hooks**, **Open at login**,
Mute, Do Not Disturb, Reset position, Quit.

## Build the app yourself

```bash
npm install            # includes electron-builder
npm run icon           # build/icon.icns + icon.png from build/icon.svg (needs rsvg-convert)
npm run dist           # -> release/Claude Spark-<ver>-arm64.dmg  and  -mac.zip  (unsigned)
```

Build config lives in `electron-builder.config.js` (unsigned by default). **To distribute
without the Gatekeeper warning**, sign + notarize:

```bash
# after obtaining an Apple Developer ID cert + notarization creds — see SIGNING.md
npm run dist:signed
```

The config flips to hardened-runtime signing + notarization when `SIGN=1` and credentials are
present. Full step-by-step in **[SIGNING.md](SIGNING.md)**. (Mac App Store isn't viable here:
its sandbox blocks writing to `~/.claude`.)

## Dev auto-launch (running from source, not the .app)

```bash
cp com.jeremy.claudespark.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.jeremy.claudespark.plist     # enable
launchctl unload ~/Library/LaunchAgents/com.jeremy.claudespark.plist   # disable
```

The **installed app** uses macOS Login Items instead (right-click → *Open at login*) — no plist needed.

## Files

| File | Role |
|---|---|
| `main.js` | Electron main: window, HTTP server, config/state, IPC, menu, terminal-focus, session tracking |
| `preload.js` | Safe renderer bridge |
| `index.html` / `style.css` / `renderer.js` | The animated mascot + state machine |
| `config.json` / `state.json` | User prefs / app-written runtime state |
| `claudecode-color.svg` | Source logo |
| `start.sh`, `com.jeremy.claudespark.plist`, `hooks.snippet.json` | Launcher, auto-start, hooks |

## Legal / disclaimer

Claude Spark is an **unofficial, fan-made** desktop companion for Claude Code. It is **not
affiliated with, endorsed by, sponsored by, or supported by Anthropic, PBC.** "Claude",
"Claude Code", and related names and logos are trademarks of Anthropic, PBC, used here for
identification/descriptive purposes only. All trademarks are the property of their respective
owners. Provided as-is, without warranty. © 2026 Jeremy Person. (Also shown in the app's
right-click → **About Claude Spark**.)

## Notes / limitations

- Click-to-focus activates the terminal **app** (Terminal, iTerm, VS Code, Warp, Ghostty, …),
  not a specific tab/window.
- Native notifications use the renderer `Notification` API; macOS may prompt once to allow them.

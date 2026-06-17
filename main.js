// Claude Spark — Electron main process.
// Transparent, always-on-top, click-through floating window showing an animated
// Claude Code mascot, plus a tiny local HTTP server that Claude Code hooks POST to.

const { app, BrowserWindow, ipcMain, screen, Menu, shell, dialog, systemPreferences } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const PORT = 47615;
const WIN_W = 240;
const WIN_H = 280;

// Writable files live in userData for a packaged (read-only) bundle; in dev we
// keep them next to the source so editing config.json works as before.
const WRITABLE_DIR = app.isPackaged ? app.getPath('userData') : __dirname;
const CONFIG_PATH = path.join(WRITABLE_DIR, 'config.json');
const STATE_PATH = path.join(WRITABLE_DIR, 'state.json');

// Claude Code settings + the hook command we install into it.
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_EVENTS = ['Stop', 'StopFailure', 'Notification', 'UserPromptSubmit', 'SubagentStop', 'PreToolUse', 'SessionStart', 'SessionEnd'];
const HOOK_CMD = "curl -s --max-time 1 -X POST \"http://127.0.0.1:47615/event?term=$TERM_PROGRAM\" -H 'Content-Type: application/json' -d @-";
const HOOK_TAG = '127.0.0.1:47615'; // detection marker

let win = null;
let config = {};
let state = {};
let saveTimer = null;

// session_id -> { start, cwd, term } — tracks each running Claude Code instance.
const sessions = new Map();

function baseName(p) { if (!p) return ''; const a = String(p).replace(/\/+$/, '').split('/'); return a[a.length - 1] || p; }
function humanizeUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

const TERM_APP = {
  Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm', iTerm2: 'iTerm',
  vscode: 'Visual Studio Code', WarpTerminal: 'Warp', Hyper: 'Hyper',
  ghostty: 'Ghostty', WezTerm: 'WezTerm', alacritty: 'Alacritty', kitty: 'kitty',
};

const DEFAULT_CONFIG = {
  corner: 'bottom-right',
  enabledEvents: { Stop: true, StopFailure: true, Notification: true, UserPromptSubmit: true, SubagentStop: true, PreToolUse: true },
  sounds: {
    enabled: true,
    done: 'file:///System/Library/Sounds/Glass.aiff',
    attention: 'file:///System/Library/Sounds/Funk.aiff',
    error: 'file:///System/Library/Sounds/Sosumi.aiff',
  },
  bubbleDurationMs: 4000,
  nudge: { enabled: true, afterMs: 12000, repeatMs: 9000, maxRepeats: 4 },
  longRunAfterMs: 120000,
  toolReactions: false,
  showOnlyDuringSessions: { enabled: false, idleFadeMs: 180000 },
  keyboard: { enabled: true, scheme: 'heat' },
};
const DEFAULT_STATE = { position: null, muted: false, doNotDisturb: false, firstRunDone: false, animMode: 'random' };

// Legal / attribution shown in the About panel and About menu item.
const COPYRIGHT = '© 2026 Jeremy Person. Unofficial fan app — not affiliated with Anthropic.';
const DISCLAIMER =
  'An unofficial, fan-made desktop companion for Claude Code.\n\n' +
  'Claude Spark is not affiliated with, endorsed by, sponsored by, or supported by ' +
  'Anthropic, PBC. "Claude", "Claude Code", and related names and logos are trademarks of ' +
  'Anthropic, PBC, used here for identification/descriptive purposes only. All trademarks are ' +
  'the property of their respective owners.\n\n' +
  'Provided as-is, without warranty. © 2026 Jeremy Person.';

function showAbout() {
  dialog.showMessageBox({
    type: 'info',
    title: 'About Claude Spark',
    message: `Claude Spark ${app.getVersion()}`,
    detail: DISCLAIMER,
    buttons: ['OK'],
  });
}

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- config / state ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return fallback; }
}

function loadConfig() {
  const user = readJson(CONFIG_PATH, null);
  if (!user) {
    // First launch with no config: seed a copy the user can edit.
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    try { fs.mkdirSync(WRITABLE_DIR, { recursive: true }); fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (_e) {}
    return;
  }
  config = { ...DEFAULT_CONFIG, ...user };
  config.enabledEvents = { ...DEFAULT_CONFIG.enabledEvents, ...(user.enabledEvents || {}) };
  config.sounds = { ...DEFAULT_CONFIG.sounds, ...(user.sounds || {}) };
  config.nudge = { ...DEFAULT_CONFIG.nudge, ...(user.nudge || {}) };
  config.showOnlyDuringSessions = { ...DEFAULT_CONFIG.showOnlyDuringSessions, ...(user.showOnlyDuringSessions || {}) };
  config.keyboard = { ...DEFAULT_CONFIG.keyboard, ...(user.keyboard || {}) };
}

// ---------- global keyboard monitor ----------
// Counts keystroke TIMING only (to gauge typing speed) — it never reads, stores,
// or transmits which keys are pressed. Requires macOS Input Monitoring permission.
let uIOhook = null;
let keyboardOn = false;
let keyHandlerBound = false;

function accessibilityTrusted(prompt) {
  if (process.platform !== 'darwin') return true;
  try { return systemPreferences.isTrustedAccessibilityClient(!!prompt); } catch (_e) { return true; }
}

function openAccessibilitySettings() {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
}

// Returns: 'on' | 'need-permission' | 'disabled' | 'error'
function startKeyboard(promptIfNeeded) {
  if (!config.keyboard || config.keyboard.enabled === false) return 'disabled';
  if (keyboardOn) return 'on';
  if (!accessibilityTrusted(promptIfNeeded)) return 'need-permission';
  try {
    ({ uIOhook } = require('uiohook-napi'));
    if (!keyHandlerBound) {
      // We intentionally ignore the event's keycode — only the fact+time of a
      // keypress is forwarded to the renderer, never which key was pressed.
      uIOhook.on('keydown', () => { if (win && win.webContents) win.webContents.send('keystroke'); });
      keyHandlerBound = true;
    }
    uIOhook.start();
    keyboardOn = true;
    console.log('[claude-spark] keyboard monitor started (timing only)');
    return 'on';
  } catch (e) {
    console.error('[claude-spark] keyboard monitor unavailable:', e.message);
    return 'error';
  }
}
function stopKeyboard() {
  try { if (uIOhook && keyboardOn) uIOhook.stop(); } catch (_e) {}
  keyboardOn = false;
}

// Fire synthetic keystrokes to preview the typing animation (used by the
// /simulate-typing route and the Animations menu).
function simulateTyping(n, interval) {
  n = Math.min(500, n || 40);
  interval = Math.max(20, interval || 90);
  let i = 0;
  const t = setInterval(() => {
    if (i++ >= n || !win || !win.webContents) return clearInterval(t);
    win.webContents.send('keystroke');
  }, interval);
}

function loadState() { state = { ...DEFAULT_STATE, ...readJson(STATE_PATH, {}) }; }

function persistState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(WRITABLE_DIR, { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }
    catch (e) { console.error('[claude-spark] could not write state.json:', e.message); }
  }, 300);
}

// ---------- hook install/remove ----------
function hooksInstalled() {
  const s = readJson(SETTINGS_PATH, {});
  const arr = s.hooks && s.hooks.Stop;
  if (!Array.isArray(arr)) return false;
  return JSON.stringify(arr).includes(HOOK_TAG);
}

function installHooks() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    const s = readJson(SETTINGS_PATH, {});
    s.hooks = s.hooks || {};
    for (const evt of HOOK_EVENTS) {
      const groups = Array.isArray(s.hooks[evt]) ? s.hooks[evt] : [];
      const already = JSON.stringify(groups).includes(HOOK_TAG);
      if (!already) groups.push({ hooks: [{ type: 'command', command: HOOK_CMD }] });
      s.hooks[evt] = groups;
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function removeHooks() {
  try {
    const s = readJson(SETTINGS_PATH, {});
    if (!s.hooks) return { ok: true };
    for (const evt of HOOK_EVENTS) {
      if (!Array.isArray(s.hooks[evt])) continue;
      s.hooks[evt] = s.hooks[evt].filter((g) => !JSON.stringify(g).includes(HOOK_TAG));
      if (s.hooks[evt].length === 0) delete s.hooks[evt];
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---------- login item ----------
function loginEnabled() {
  try { return app.getLoginItemSettings().openAtLogin; } catch (_e) { return false; }
}
function setLogin(enabled) {
  try { app.setLoginItemSettings({ openAtLogin: !!enabled }); } catch (_e) {}
}

// ---------- window ----------
function cornerPosition() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const m = 24;
  switch (config.corner) {
    case 'bottom-left': return { x: x + m, y: y + height - WIN_H - m };
    case 'top-right':   return { x: x + width - WIN_W - m, y: y + m };
    case 'top-left':    return { x: x + m, y: y + m };
    default:            return { x: x + width - WIN_W - m, y: y + height - WIN_H - m };
  }
}

function createWindow() {
  const pos = (state.position && Number.isFinite(state.position.x)) ? state.position : cornerPosition();
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, x: pos.x, y: pos.y,
    transparent: true, frame: false, resizable: false, movable: true,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: true,
    fullscreenable: false, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('did-finish-load', () => win.webContents.send('config', { config, state }));
  // In dev, surface renderer console output to the terminal for debugging.
  if (!app.isPackaged) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error('[renderer]', message);
    });
  }
  win.loadFile('index.html');
}

function pushConfig() { if (win && win.webContents) win.webContents.send('config', { config, state }); }

// ---------- first-run ----------
function maybeFirstRun() {
  if (state.firstRunDone) return;
  state.firstRunDone = true;
  persistState();
  const installed = hooksInstalled();
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: installed ? ['Great, thanks', 'Open settings.json'] : ['Install hooks', 'Not now'],
    defaultId: 0,
    title: 'Claude Spark',
    message: 'Welcome to Claude Spark ✦',
    detail: installed
      ? 'Claude Code hooks are already installed — the mascot will react to your sessions. You can manage hooks and startup from the right-click menu.'
      : 'To react to Claude Code, Spark needs to add a few hooks to ~/.claude/settings.json (they just notify this app and never block Claude Code). Install them now?',
  });
  if (!installed && choice === 0) {
    const r = installHooks();
    dialog.showMessageBoxSync({ type: r.ok ? 'info' : 'error', title: 'Claude Spark',
      message: r.ok ? 'Hooks installed.' : 'Could not install hooks', detail: r.ok ? 'Restart any running Claude Code sessions to pick them up.' : r.error });
  } else if (installed && choice === 1) {
    shell.openPath(SETTINGS_PATH);
  }
}

// ---------- IPC ----------
ipcMain.on('set-clickable', (_e, c) => { if (win) win.setIgnoreMouseEvents(!c, { forward: true }); });
ipcMain.on('set-state', (_e, patch) => { state = { ...state, ...patch }; persistState(); pushConfig(); });
ipcMain.on('move-window', (_e, { dx, dy }) => { if (!win) return; const [x, y] = win.getPosition(); win.setPosition(Math.round(x + dx), Math.round(y + dy)); });
ipcMain.on('drag-end', () => { if (!win) return; const [x, y] = win.getPosition(); state.position = { x, y }; persistState(); });
ipcMain.on('focus-terminal', (_e, sessionId) => {
  const info = (sessionId && sessions.get(sessionId)) || [...sessions.values()].pop();
  const appName = info && TERM_APP[info.term];
  if (appName) execFile('osascript', ['-e', `tell application "${appName}" to activate`], () => {});
});
ipcMain.on('quit-app', () => app.quit());

ipcMain.on('show-context-menu', (_e, info) => {
  const muted = !!state.muted, dnd = !!state.doNotDisturb;
  const installed = hooksInstalled();
  const now = Date.now();
  const live = [...sessions.values()].sort((a, b) => a.start - b.start);
  const sessionItems = live.length
    ? live.map((s) => ({ label: `   ${baseName(s.cwd) || 'session'} — ${humanizeUptime(now - s.start)}`, enabled: false }))
    : [{ label: '   none running', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: `Claude Code running: ${live.length}`, enabled: false },
    ...sessionItems,
    { type: 'separator' },
    { label: `Tasks today: ${info && info.tasksToday != null ? info.tasksToday : 0}`, enabled: false },
    { type: 'separator' },
    { label: muted ? 'Unmute' : 'Mute', click: () => { state.muted = !muted; persistState(); pushConfig(); } },
    { label: 'Do Not Disturb', type: 'checkbox', checked: dnd, click: () => { state.doNotDisturb = !dnd; persistState(); pushConfig(); } },
    { label: 'Reset position', click: () => { const p = cornerPosition(); if (win) win.setPosition(p.x, p.y); state.position = null; persistState(); } },
    { type: 'separator' },
    { label: 'Animations', submenu: [
        { label: 'Random (default)', type: 'radio', checked: state.animMode !== 'calm',
          click: () => { state.animMode = 'random'; persistState(); pushConfig(); if (win) win.webContents.send('anim-mode', 'random'); } },
        { label: 'Calm (idle only)', type: 'radio', checked: state.animMode === 'calm',
          click: () => { state.animMode = 'calm'; persistState(); pushConfig(); if (win) win.webContents.send('anim-mode', 'calm'); } },
        { type: 'separator' },
        { label: 'Play', submenu: [
            { label: 'Celebrate 🎉', click: () => win && win.webContents.send('play-animation', 'done') },
            { label: 'Working', click: () => win && win.webContents.send('play-animation', 'working') },
            { label: 'Needs you 👀', click: () => win && win.webContents.send('play-animation', 'attention') },
            { label: 'Error ⚠️', click: () => win && win.webContents.send('play-animation', 'error') },
            { label: 'Subagent nod', click: () => win && win.webContents.send('play-animation', 'subagent') },
            { label: 'Long run', click: () => win && win.webContents.send('play-animation', 'longrun') },
            { type: 'separator' },
            { label: 'Spin', click: () => win && win.webContents.send('play-animation', 'spin') },
            { label: 'Wiggle', click: () => win && win.webContents.send('play-animation', 'wiggle') },
            { label: 'Hop', click: () => win && win.webContents.send('play-animation', 'hop') },
            { label: 'Typing burst ⌨️', click: () => simulateTyping(50, 80) },
        ] },
    ] },
    { type: 'separator' },
    { label: installed ? 'Remove Claude Code hooks' : 'Install Claude Code hooks', click: () => {
        const r = installed ? removeHooks() : installHooks();
        dialog.showMessageBoxSync({ type: r.ok ? 'info' : 'error', title: 'Claude Spark',
          message: r.ok ? (installed ? 'Hooks removed.' : 'Hooks installed.') : 'Something went wrong',
          detail: r.ok ? 'Restart running Claude Code sessions to apply.' : r.error });
      } },
    { label: keyboardOn ? 'Typing reactions: on ✓' : 'Retry typing access…', enabled: !keyboardOn, click: () => {
        const r = startKeyboard(true);
        if (r === 'on') dialog.showMessageBoxSync({ type: 'info', title: 'Claude Spark', message: 'Typing reactions enabled.' });
        else if (r === 'need-permission') { openAccessibilitySettings(); dialog.showMessageBoxSync({ type: 'info', title: 'Claude Spark', message: 'Accessibility permission needed', detail: 'Enable Claude Spark under Privacy & Security → Accessibility, then choose “Retry typing access” again.' }); }
        else if (r === 'disabled') dialog.showMessageBoxSync({ type: 'info', title: 'Claude Spark', message: 'Typing reactions are disabled in config.json (keyboard.enabled).' });
      } },
    { label: 'Open at login', type: 'checkbox', checked: loginEnabled(), click: () => setLogin(!loginEnabled()) },
    { label: 'Open config.json', click: () => shell.openPath(CONFIG_PATH) },
    { type: 'separator' },
    { label: 'About Claude Spark', click: () => showAbout() },
    { label: 'Quit Claude Spark', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
});

// ---------- HTTP server ----------
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }

    // Running Claude Code instances + uptime (also surfaced in the right-click menu).
    if (req.method === 'GET' && url.pathname === '/sessions') {
      const now = Date.now();
      const list = [...sessions.entries()]
        .sort((a, b) => a[1].start - b[1].start)
        .map(([id, s]) => ({ id, project: baseName(s.cwd), cwd: s.cwd, term: s.term, uptimeMs: now - s.start, uptime: humanizeUptime(now - s.start) }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: list.length, sessions: list }, null, 2));
      return;
    }

    // Preview the typing animation without the global monitor (e.g. before
    // granting Accessibility). GET /simulate-typing?n=40&interval=80
    if (url.pathname === '/simulate-typing') {
      const n = parseInt(url.searchParams.get('n') || '40', 10) || 40;
      const interval = parseInt(url.searchParams.get('interval') || '90', 10) || 90;
      simulateTyping(n, interval);
      res.writeHead(200); res.end(`simulating ${n} keys @${interval}ms`);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/event') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let payload = {};
        try { payload = body ? JSON.parse(body) : {}; } catch (_e) { payload = { hook_event_name: 'Unknown', _raw: body }; }
        const term = url.searchParams.get('term'); const sid = payload.session_id;
        recordSession(payload, sid, term);
        if (win && win.webContents) win.webContents.send('claude-event', payload);
        res.writeHead(200); res.end('ok');
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.on('error', (err) => console.error('[claude-spark] server error:', err.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`[claude-spark] listening on http://127.0.0.1:${PORT}`));
}

function recordSession(payload, sid, term) {
  if (!sid) return;
  const evt = payload.hook_event_name;
  if (evt === 'SessionEnd') {
    sessions.delete(sid);
  } else {
    let info = sessions.get(sid);
    if (!info) { info = { start: Date.now(), cwd: payload.cwd, term }; sessions.set(sid, info); }
    if (payload.cwd) info.cwd = payload.cwd;
    if (term) info.term = term;
    // SessionStart is the authoritative start time (overrides a lazily-set one).
    if (evt === 'SessionStart') info.start = Date.now();
  }
  if (win && win.webContents) win.webContents.send('session-count', sessions.size);
}

// ---------- lifecycle ----------
app.whenReady().then(() => {
  loadConfig();
  loadState();
  app.setName('Claude Spark');
  app.setAboutPanelOptions({
    applicationName: 'Claude Spark',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: `${COPYRIGHT}\n\n${DISCLAIMER}`,
    credits: 'A fan-made companion for Claude Code.',
  });
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  startServer();
  const kb = startKeyboard(false);
  if (kb === 'need-permission') setTimeout(promptKeyboardPermission, 1200);
  setTimeout(maybeFirstRun, 800);
});

function promptKeyboardPermission() {
  if (state.keyboardPermAsked) return;
  state.keyboardPermAsked = true;
  persistState();
  const choice = dialog.showMessageBoxSync({
    type: 'info', buttons: ['Open Accessibility settings', 'Later'], defaultId: 0,
    title: 'Claude Spark — typing reactions',
    message: 'Let the mascot react to your typing?',
    detail: 'To animate while you type (and shift color with your speed), Spark needs Accessibility permission. It only measures keystroke timing — it never reads or stores which keys you press.\n\nEnable “Claude Spark” (or your terminal/Electron in dev) under Privacy & Security → Accessibility, then use the right-click menu → “Retry typing access”.',
  });
  if (choice === 0) { accessibilityTrusted(true); openAccessibilitySettings(); }
}
app.on('will-quit', stopKeyboard);
app.on('window-all-closed', () => { /* stay alive */ });

// Bridges the sandboxed renderer to the main process safely.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spark', {
  // Events forwarded from the local HTTP server.
  onClaudeEvent: (cb) => ipcRenderer.on('claude-event', (_e, payload) => cb(payload)),
  // Merged { config, state } pushed at load and whenever state changes.
  onConfig: (cb) => ipcRenderer.on('config', (_e, data) => cb(data)),
  // Active Claude Code session count.
  onSessionCount: (cb) => ipcRenderer.on('session-count', (_e, n) => cb(n)),
  // A keystroke happened somewhere (timing only — no key data).
  onKeystroke: (cb) => ipcRenderer.on('keystroke', () => cb()),
  // Right-click "Animations" menu.
  onPlayAnimation: (cb) => ipcRenderer.on('play-animation', (_e, name) => cb(name)),
  onAnimMode: (cb) => ipcRenderer.on('anim-mode', (_e, mode) => cb(mode)),
  // Local music mini-player.
  onNowPlaying: (cb) => ipcRenderer.on('now-playing', (_e, np) => cb(np)),
  musicControl: (app, action) => ipcRenderer.send('music-control', { app, action }),

  // Window: capture mouse (true) vs click-through (false).
  setClickable: (clickable) => ipcRenderer.send('set-clickable', !!clickable),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  resetPosition: () => ipcRenderer.send('reset-position'),

  // Actions
  focusTerminal: (sessionId) => ipcRenderer.send('focus-terminal', sessionId),
  showContextMenu: (info) => ipcRenderer.send('show-context-menu', info),
  setState: (patch) => ipcRenderer.send('set-state', patch),
  quit: () => ipcRenderer.send('quit-app'),
});

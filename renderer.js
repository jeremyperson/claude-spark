// Claude Spark — renderer state machine.
// Maps Claude Code events to animation + bubble + sound + native notification,
// with project/elapsed info, escalating nudges, error/long-run states, daily
// stats, tool reactions, drag-to-move, click-to-focus, and config gating.

const character = document.getElementById('character');
const card = character.querySelector('.card');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const muteEl = document.getElementById('mute');
const dndEl = document.getElementById('dnd');
const toolLabel = document.getElementById('tool-label');
const snd = document.getElementById('snd');

const STATE_CLASSES = ['state-idle', 'state-working', 'state-longrun', 'state-done', 'state-attention', 'state-subagent', 'state-error'];

let cfg = {};         // config
let st = {};          // persisted state (muted, doNotDisturb, position)
let sessionCount = 0;

let idleTimer = null;
let bubbleTimer = null;
let longRunTimer = null;
let nudgeTimer = null;
let nudgeCount = 0;
let fadeTimer = null;
let lastAttention = null; // { sessionId }
let currentSession = null;

// session_id -> { start, cwd }
const sessions = new Map();

// ---------- config wiring ----------
window.spark.onConfig(({ config, state }) => {
  cfg = config || {};
  st = state || {};
  if (cfg.sounds && cfg.sounds.done) snd.src = cfg.sounds.done; // default; swapped per-play
  updateBadges();
  applyVisibilityPolicy();
  setAnimMode(st.animMode || 'random');
});
window.spark.onSessionCount((n) => { sessionCount = n; applyVisibilityPolicy(); });

function updateBadges() {
  muteEl.classList.toggle('hidden', !st.muted);
  dndEl.classList.toggle('hidden', !st.doNotDisturb);
}

// ---------- helpers ----------
function setState(state, holdMs) {
  STATE_CLASSES.forEach((c) => character.classList.remove(c));
  character.classList.add('state-' + state);
  clearTimeout(idleTimer);
  // transient states auto-return to idle; working/longrun persist until Stop
  if (!['idle', 'working', 'longrun'].includes(state)) {
    idleTimer = setTimeout(() => setState('idle'), holdMs || (cfg.bubbleDurationMs || 4000));
  }
}

function showBubble(text, ms) {
  bubbleText.textContent = text;
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms || cfg.bubbleDurationMs || 4000);
}

function play(which) {
  if (st.muted || st.doNotDisturb) return;
  if (!cfg.sounds || !cfg.sounds.enabled) return;
  const src = cfg.sounds[which];
  if (!src) return;
  try {
    snd.src = src;
    snd.currentTime = 0;
    const p = snd.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_e) { /* ignore */ }
}

function notify(title, body) {
  if (st.muted || st.doNotDisturb) return;
  try { new Notification(title, { body, silent: true }); } catch (_e) { /* ignore */ }
}

function basename(p) {
  if (!p) return '';
  const parts = String(p).replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m${r}s` : `${m}m`;
}

function enabled(evt) {
  return !cfg.enabledEvents || cfg.enabledEvents[evt] !== false;
}

// ---------- daily stats ----------
function todayKey() {
  const d = new Date();
  return `spark-stats-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function bumpTasksToday() {
  const k = todayKey();
  const n = (parseInt(localStorage.getItem(k) || '0', 10) || 0) + 1;
  localStorage.setItem(k, String(n));
  return n;
}
function tasksToday() {
  return parseInt(localStorage.getItem(todayKey()) || '0', 10) || 0;
}

// ---------- nudge ----------
function startNudge() {
  clearNudge();
  if (!cfg.nudge || !cfg.nudge.enabled) return;
  nudgeCount = 0;
  nudgeTimer = setTimeout(repeatNudge, cfg.nudge.afterMs || 12000);
}
function repeatNudge() {
  nudgeCount++;
  if (nudgeCount > (cfg.nudge.maxRepeats || 4)) return clearNudge();
  character.classList.add('nudge');
  setTimeout(() => character.classList.remove('nudge'), 700);
  play('attention');
  nudgeTimer = setTimeout(repeatNudge, cfg.nudge.repeatMs || 9000);
}
function clearNudge() {
  clearTimeout(nudgeTimer);
  nudgeTimer = null;
  character.classList.remove('nudge');
}

// ---------- long run ----------
function armLongRun() {
  clearTimeout(longRunTimer);
  longRunTimer = setTimeout(() => {
    setState('longrun');
    showBubble('Still working…', 6000);
  }, cfg.longRunAfterMs || 120000);
}

// ---------- visibility policy (show only during sessions) ----------
function applyVisibilityPolicy() {
  const policy = cfg.showOnlyDuringSessions;
  document.body.classList.remove('faded');
  clearTimeout(fadeTimer);
  if (!policy || !policy.enabled) return; // always visible
  if (sessionCount > 0) return;           // active session -> visible
  fadeTimer = setTimeout(() => document.body.classList.add('faded'), policy.idleFadeMs || 180000);
}
function wake() {
  document.body.classList.remove('faded');
  applyVisibilityPolicy();
}

// ---------- event routing ----------
function handleEvent(payload) {
  const event = (payload && payload.hook_event_name) || '';
  const ntype = (payload && payload.notification_type) || '';
  const msg = (payload && payload.message) || '';
  const sid = payload && payload.session_id;
  const cwd = payload && payload.cwd;
  currentSession = sid || currentSession;

  if (event && !enabled(event)) return;
  wake();
  if (event !== 'Notification') clearNudge();

  // error detection (explicit failure events or error-ish text)
  const looksError = /failure|error|failed/i.test(event + ' ' + ntype + ' ' + msg);

  switch (event) {
    case 'StopFailure':
      clearTimeout(longRunTimer);
      setState('error', 5000);
      showBubble('Something broke ⚠️', 5000);
      play('error');
      notify('Claude Code — error', basename(cwd) || 'A turn failed');
      break;

    case 'Stop': {
      clearTimeout(longRunTimer);
      let line = 'Done! 🎉';
      const s = sid && sessions.get(sid);
      const proj = basename((s && s.cwd) || cwd);
      if (s && s.start) line = `${proj ? proj + ' · ' : ''}done in ${fmtDuration(Date.now() - s.start)}`;
      else if (proj) line = `${proj} · done 🎉`;
      if (sid) sessions.delete(sid);
      const n = bumpTasksToday();
      setState('done', 4000);
      showBubble(line, 4000);
      play('done');
      notify('Claude Code — done', `${line}  ·  ${n} today`);
      break;
    }

    case 'UserPromptSubmit':
      if (sid) sessions.set(sid, { start: Date.now(), cwd });
      setState('working');
      showBubble('On it…', 2500);
      armLongRun();
      break;

    case 'SubagentStop':
      setState('subagent', 2500);
      showBubble('Subagent done', 2500);
      break;

    case 'PreToolUse': {
      if (!cfg.toolReactions) return;
      const tool = (payload && payload.tool_name) || 'tool';
      toolLabel.textContent = tool.toLowerCase();
      toolLabel.classList.remove('hidden');
      character.classList.add('tooltick');
      clearTimeout(toolLabel._t);
      toolLabel._t = setTimeout(() => {
        toolLabel.classList.add('hidden');
        character.classList.remove('tooltick');
      }, 1200);
      return; // don't disturb the main state
    }

    case 'SessionStart':
    case 'SessionEnd':
      return; // counted in main; no visible reaction

    case 'Notification': {
      const text = (ntype + ' ' + msg).toLowerCase();
      const isPermission = /permission|approve|allow/.test(text);
      lastAttention = { sessionId: sid };
      setState('attention', cfg.nudge && cfg.nudge.enabled ? 60000 : 6000);
      const line = isPermission ? 'Needs your OK 👀' : (msg ? trim(msg) : 'Ready for you ✨');
      showBubble(line, 6000);
      play('attention');
      notify('Claude Code', line);
      startNudge();
      break;
    }

    default:
      if (looksError) { setState('error', 4000); play('error'); }
      else setState('subagent', 2000);
      if (msg) showBubble(trim(msg), 3000);
      break;
  }
}

function trim(s) {
  s = String(s).trim();
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

// ---------- interaction: hover / drag / click / right-click ----------
character.addEventListener('mouseenter', () => window.spark.setClickable(true));
character.addEventListener('mouseleave', () => window.spark.setClickable(false));

let dragging = false;
let moved = false;
let startX = 0, startY = 0;

character.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // left only
  dragging = true;
  moved = false;
  startX = e.screenX;
  startY = e.screenY;
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - startX;
  const dy = e.screenY - startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
  if (moved) {
    window.spark.moveWindow(dx, dy);
    startX = e.screenX;
    startY = e.screenY;
  }
});
window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  if (moved) {
    window.spark.dragEnd();
  } else if (e.button === 0) {
    // a click (no drag): focus the relevant terminal
    clearNudge();
    window.spark.focusTerminal(lastAttention ? lastAttention.sessionId : currentSession);
  }
});

character.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.spark.showContextMenu({ tasksToday: tasksToday() });
});

// ---------- typing reactions (timing only — never key contents) ----------
const logoPath = character.querySelector('.logo path');
const keycapsEl = document.getElementById('keycaps');
const keyTimes = [];        // recent keystroke timestamps (ms)
let typingIntensity = 0;    // 0..1 smoothed
let lastKeycap = 0;
let typingRAF = null;

// scheme stops: [intensity, hex]
const SCHEMES = {
  heat: [[0, [217, 119, 87]], [0.5, [232, 134, 46]], [1, [229, 72, 77]]],
  cool: [[0, [217, 119, 87]], [0.5, [43, 179, 163]], [1, [59, 130, 246]]],
};

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function colorFor(intensity) {
  const scheme = (cfg.keyboard && cfg.keyboard.scheme) || 'heat';
  if (scheme === 'rainbow') {
    const hue = Math.round((Date.now() / 8 + intensity * 320) % 360);
    return `hsl(${hue} 75% 55%)`;
  }
  const stops = SCHEMES[scheme] || SCHEMES.heat;
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (intensity >= stops[i][0] && intensity <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const span = hi[0] - lo[0] || 1;
  const t = Math.min(1, Math.max(0, (intensity - lo[0]) / span));
  const c = [0, 1, 2].map((k) => lerp(lo[1][k], hi[1][k], t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function typingActive() {
  // Don't fight the strong reaction states; let typing tint idle/working/longrun.
  return ['state-idle', 'state-working', 'state-longrun'].some((c) => character.classList.contains(c));
}

function onKeystroke() {
  if (!cfg.keyboard || cfg.keyboard.enabled === false) return;
  const now = Date.now();
  keyTimes.push(now);
  while (keyTimes.length && now - keyTimes[0] > 2000) keyTimes.shift();
  wake();

  // per-key bounce
  if (typingActive()) {
    character.classList.add('keytap');
    clearTimeout(character._kt);
    character._kt = setTimeout(() => character.classList.remove('keytap'), 110);
  }
  // floating keycap (throttled; generic glyph — we never know which key)
  if (now - lastKeycap > 85 && typingActive()) { lastKeycap = now; emitKeycap(); }

  if (!typingRAF) tick();
}

function currentRate() {
  // keys/sec over the last 1.2s
  const now = Date.now();
  const recent = keyTimes.filter((t) => now - t < 1200);
  return recent.length / 1.2;
}

function tick() {
  const kps = currentRate();
  const target = Math.min(1, kps / 8); // ~8 keys/sec => full heat
  typingIntensity += (target - typingIntensity) * 0.25;

  if (typingActive() && typingIntensity > 0.02) {
    const col = colorFor(typingIntensity);
    logoPath.style.fill = col;
    card.style.boxShadow = `0 0 ${10 + typingIntensity * 26}px ${col}, 0 8px 18px rgba(60,30,15,0.28)`;
  } else {
    logoPath.style.fill = '';
    card.style.boxShadow = '';
  }

  if (typingIntensity > 0.02 || keyTimes.length) {
    typingRAF = requestAnimationFrame(tick);
  } else {
    typingRAF = null;
    typingIntensity = 0;
    logoPath.style.fill = '';
    card.style.boxShadow = '';
  }
}

function emitKeycap() {
  const cap = document.createElement('span');
  cap.className = 'keycap';
  cap.style.left = (38 + Math.random() * 40) + '%';
  cap.style.setProperty('--drift', (Math.random() * 24 - 12) + 'px');
  keycapsEl.appendChild(cap);
  setTimeout(() => cap.remove(), 700);
}

window.spark.onKeystroke(onKeystroke);

// ---------- Animations menu (play on demand + random idle flourishes) ----------
function playNamed(name) {
  switch (name) {
    case 'done': setState('done', 4000); showBubble('Done! 🎉', 4000); play('done'); break;
    case 'working': setState('working'); showBubble('On it…', 2500); setTimeout(() => { if (character.classList.contains('state-working')) setState('idle'); }, 3000); break;
    case 'attention': setState('attention', 4000); showBubble('Needs your OK 👀', 4000); play('attention'); break;
    case 'error': setState('error', 4000); showBubble('Something broke ⚠️', 4000); play('error'); break;
    case 'subagent': setState('subagent', 2500); showBubble('Subagent done', 2500); break;
    case 'longrun': setState('longrun'); showBubble('Still working…', 4000); setTimeout(() => { if (character.classList.contains('state-longrun')) setState('idle'); }, 4000); break;
    case 'spin': case 'wiggle': case 'hop': flourish('flourish-' + name); break;
    default: break;
  }
}

const FLOURISHES = ['flourish-spin', 'flourish-wiggle', 'flourish-hop', 'state-subagent'];
function flourish(cls) {
  character.classList.add(cls);
  setTimeout(() => character.classList.remove(cls), 850);
}

let animMode = 'random';
let randomTimer = null;
function setAnimMode(mode) {
  animMode = mode || 'random';
  clearInterval(randomTimer);
  randomTimer = null;
  if (animMode === 'random') {
    randomTimer = setInterval(() => {
      // Only flourish when truly idle and on screen — never interrupt reactions/typing.
      if (!character.classList.contains('state-idle')) return;
      if (typingIntensity > 0.05 || keyTimes.length) return;
      if (document.body.classList.contains('faded')) return;
      flourish(FLOURISHES[Math.floor(Math.random() * FLOURISHES.length)]);
    }, 17000);
  }
}

window.spark.onPlayAnimation(playNamed);
window.spark.onAnimMode(setAnimMode);

// ---------- boot ----------
window.spark.onClaudeEvent(handleEvent);
setState('idle');

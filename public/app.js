const $ = (s) => document.querySelector(s);
const thread = $('#thread'), input = $('#input'), sendBtn = $('#sendBtn');
let lastId = 0, lastTs = 0, busy = false, me = null;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...opts });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ── login ──
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#pw').focus(); }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const res = await fetch('/api/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: $('#pw').value }) });
  if (res.ok) { $('#login').hidden = true; start(); }
  else $('#loginErr').textContent = (await res.json().catch(() => ({}))).error || 'nope';
};

// ── thread rendering ──
function stampFor(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

function nearBottom() { return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120; }
function toBottom() { thread.scrollTop = thread.scrollHeight; }

function render(m, { scroll = true } = {}) {
  if (m.id && m.id <= lastId) return;
  if (m.ts - lastTs > 60 * 60e3) {
    const s = document.createElement('div');
    s.className = 'stamp'; s.textContent = stampFor(m.ts);
    thread.appendChild(s);
  }
  const b = document.createElement('div');
  b.className = `b ${m.role}`;
  b.textContent = m.content;
  thread.appendChild(b);
  if (m.id) lastId = m.id;
  lastTs = m.ts;
  if (scroll) toBottom();
}

// Mood shows up quietly: a status line and the color of the avatar ring.
let mood = null;
function setMood(m) {
  if (!m) return;
  mood = m;
  document.documentElement.style.setProperty('--mood-h', m.hue);
  document.documentElement.style.setProperty('--mood-s', m.sat + '%');
  if (!$('.typing')) $('#status').textContent = `${m.emoji} ${m.word}`;
}
function setName(name) {
  $('#name').textContent = name || 'no name yet';
  document.title = name || 'Messages';
  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = name || 'Messages';
}
function delivered(reason) {
  $('.delivered')?.remove();
  if (!reason) return;
  const d = document.createElement('div');
  d.className = 'delivered';
  d.textContent = 'Delivered';
  thread.appendChild(d);
  toBottom();
}

function typing(on) {
  $('.typing')?.remove();
  $('#status').textContent = on ? 'typing…' : mood ? `${mood.emoji} ${mood.word}` : '';
  if (on) { const t = document.createElement('div'); t.className = 'typing'; t.innerHTML = '<i></i><i></i><i></i>'; thread.appendChild(t); toBottom(); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Reveal multi-bubble replies one at a time, like someone double-texting.
async function playIn(msgs) {
  for (let i = 0; i < msgs.length; i++) {
    if (i > 0) { typing(true); await wait(Math.min(400 + msgs[i].content.length * 18, 1800)); }
    typing(false);
    render(msgs[i]);
    if (msgs[i].role === 'friend') speak(msgs[i].content);
  }
}

// ── sending ──
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  unlockSpeech();   // must happen inside the tap on iOS
  busy = true; sendBtn.disabled = true;
  input.value = ''; autoGrow();
  delivered(null);
  render({ role: 'user', content: text, ts: Date.now() });
  await wait(500);
  typing(true);
  try {
    const res = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
    await sync(true);              // picks up the stored copy of his own message id
    typing(false);
    setMood(res.mood);
    if (res.name) setName(res.name);
    if (res.pending) delivered(res.pending);   // it's sitting on this one (asleep / left on read)
    await playIn(res.messages.filter((m) => m.id > lastId));
  } catch (e) {
    typing(false);
    if (e.message !== 'unauthorized') {
      const f = document.createElement('div'); f.className = 'b friend fail'; f.textContent = `(didn't go through: ${e.message})`;
      thread.appendChild(f); toBottom();
    }
  }
  busy = false; sendBtn.disabled = false;
}

$('#composer').onsubmit = (e) => { e.preventDefault(); send(input.value); };
input.addEventListener('keydown', (e) => {
  // Enter sends on a keyboard; on phones the return key makes a new line unless enterkeyhint handles it.
  if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(input.value); }
});
function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
input.addEventListener('input', autoGrow);

// Pull in anything new (texts he sent first while the app was closed).
// ownOnly: just advance past the user message we already drew locally.
async function sync(ownOnly = false) {
  const res = await api(`/api/messages?after=${lastId}`);
  for (const m of res.messages) {
    if (ownOnly) { if (m.role === 'user') { lastId = m.id; continue; } break; }  // already drawn locally
    if (m.role === 'friend') delivered(null);
    render(m, { scroll: nearBottom() });
  }
  if (ownOnly) return;
  setMood(res.mood);
  setName(res.name);
  if (!res.pending) delivered(null);
}

async function loadAll() {
  const res = await api('/api/messages');
  thread.innerHTML = ''; lastId = 0; lastTs = 0;
  for (const m of res.messages) render(m, { scroll: false });
  setMood(res.mood);
  setName(res.name);
  delivered(res.pending);
  toBottom();
}

// ── voice: talk-to-text + read replies aloud ──
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (!Rec) $('#micBtn').hidden = true;
$('#micBtn').onclick = () => {
  if (rec) { rec.stop(); return; }
  rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim += r[0].transcript));
    input.value = finalText || interim; autoGrow();
  };
  rec.onend = () => { $('#micBtn').classList.remove('on'); rec = null; if (input.value.trim()) send(input.value); };
  // Say why it failed instead of failing silently (iPhone home-screen apps often block this).
  rec.onerror = (e) => {
    const why = { 'not-allowed': 'Mic permission is off for this app.', 'service-not-allowed': "Your phone blocks voice typing inside this app. Use the mic on your keyboard instead (it works everywhere).",
      'no-speech': "Didn't hear anything.", network: 'Voice typing needs a connection.' }[e.error] || `Voice typing failed (${e.error}).`;
    const f = document.createElement('div'); f.className = 'b friend fail'; f.textContent = why;
    thread.appendChild(f); toBottom();
  };
  $('#micBtn').classList.add('on');
  rec.start();
};

$('#speak').checked = store.get('speak') === '1';
$('#speak').onchange = () => store.set('speak', $('#speak').checked ? '1' : '0');
// Read-aloud uses the phone/browser's built-in voices (stopgap until live calls).
// iOS only allows speech that starts inside a tap, so unlockSpeech() runs on the
// send tap; after that, replies can be spoken when they arrive.
let speechUnlocked = false;
function unlockSpeech() {
  if (speechUnlocked || !$('#speak').checked || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
  speechUnlocked = true;
}
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  const score = (v) => (/premium|enhanced|neural|natural/i.test(v.name) ? 10 : 0)
    + (/aaron|evan|nathan|tom|alex|daniel|guy|davis|andrew|brian|christopher|eric|male/i.test(v.name) ? 5 : 0)
    + (/en-US/i.test(v.lang) ? 2 : 0) - (/compact|eloquence|novelty|bad news|bells|whisper/i.test(v.name) ? 20 : 0);
  return vs.sort((a, b) => score(b) - score(a))[0] || null;
}
function speak(text) {
  if (!$('#speak').checked || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}]/gu, ''));
  const v = pickVoice();
  if (v) u.voice = v;
  // His mood shapes the delivery: tired = slower and softer, hyped/playful = quicker.
  const w = mood?.word || '';
  u.rate = /asleep|fading|off/.test(w) ? 0.88 : /no good|good mood|curious/.test(w) ? 1.1 : 1.0;
  u.pitch = /worried|off|salty/.test(w) ? 0.9 : 1.0;
  u.volume = /asleep|fading/.test(w) ? 0.7 : 1;
  speechSynthesis.speak(u);
}
$('#speak').addEventListener('change', unlockSpeech);

// ── calls ──
$('#callBtn').onclick = () => window.HomieCall?.open();
$('#handsfreeSetting').checked = store.get('callMode') === 'handsfree';
$('#handsfreeSetting').onchange = (e) => store.set('callMode', e.target.checked ? 'handsfree' : 'ptt');
function drawCalls(calls = []) {
  const box = $('#callLog');
  if (!calls.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h4>Recent calls</h4>';
  for (const c of calls) {
    const p = document.createElement('p'); p.className = 'note';
    p.textContent = `${c.when} · ${c.mode === 'handsfree' ? 'hands-free' : 'push-to-talk'} · ${c.minutes ?? '?'} min · ${c.turns} turns · $${c.usd.toFixed(3)}`
      + `${c.usdPer10Min != null ? ` ($${c.usdPer10Min.toFixed(3)}/10 min)` : ''}${c.latencyMedianMs ? ` · ~${(c.latencyMedianMs / 1000).toFixed(1)}s replies` : ''}${c.retries ? ` · ${c.retries} retries` : ''}`;
    box.appendChild(p);
  }
}

// ── settings sheet / memory ──
$('#menuBtn').onclick = () => { $('#sheet').hidden = false; loadMemory(); };
$('#closeSheet').onclick = () => { $('#sheet').hidden = true; };
$('#sheet').onclick = (e) => { if (e.target.id === 'sheet') $('#sheet').hidden = true; };

function drawWonders(wonders, searchEnabled) {
  $('#searchNote').textContent = searchEnabled ? '' : 'Web is off: he thinks things through on his own.';
  $('#wonders').innerHTML = wonders.length ? '' : '<li><span class="note">nothing yet</span></li>';
  for (const w of wonders) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    const icon = { open: '💭', searched: '🔎', pondered: '🤔', dropped: '·' }[w.status] || '·';
    span.textContent = `${icon} ${w.question}`;
    const small = document.createElement('small');
    small.textContent = w.status === 'open' ? 'still wondering' : `${w.when} · ${w.why}`;
    span.appendChild(small);
    if (w.thought) { const t = document.createElement('small'); t.textContent = `“${w.thought}”`; span.appendChild(t); }
    for (const s of w.sources || []) {
      const a = document.createElement('a');
      a.href = s.url; a.textContent = s.title || s.url; a.target = '_blank'; a.rel = 'noopener';
      a.style.cssText = 'display:block;font-size:12px;color:var(--me)';
      span.appendChild(a);
    }
    li.appendChild(span);
    $('#wonders').appendChild(li);
  }
}

function drawMemory({ facts, followups, summary, episodes = [], journal = [], self, feeling, mood: md, affect, drives, urge, neuro, wonders = [], searchEnabled = true, calls = [] }) {
  drawWonders(wonders, searchEnabled);
  drawCalls(calls);
  setMood(md);
  $('#feeling').textContent = feeling ? feeling.charAt(0).toUpperCase() + feeling.slice(1) : '';
  $('#episodes').innerHTML = episodes.length ? '' : '<li><span class="note">nothing yet</span></li>';
  for (const e of episodes) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><i><b></b></i>';
    li.querySelector('span').textContent = e.gist;
    const s = document.createElement('small');
    s.textContent = `${e.ago} ago · felt ${e.felt}${e.open ? ' · unresolved' : ''}`;
    li.querySelector('span').appendChild(s);
    li.querySelector('b').style.width = Math.round(e.strength * 100) + '%';
    $('#episodes').appendChild(li);
  }
  $('#journal').innerHTML = journal.length ? '' : '<p class="note">(he writes one every night once you two have talked)</p>';
  for (const j of journal) {
    const d = document.createElement('div');
    d.className = 'entry';
    d.innerHTML = '<small></small>';
    d.querySelector('small').textContent = `${j.day} · ${j.mood || ''}`;
    d.appendChild(document.createTextNode(j.entry));
    $('#journal').appendChild(d);
  }
  $('#self').textContent = self ? `Who he thinks he is: ${self}` : '';
  const neuroLine = neuro?.online
    ? `neurons: online · settled in "${neuro.dominant}" · focus ${neuro.focus}`
    : `neurons: offline${neuro?.at ? ` since ${new Date(neuro.at).toLocaleString()}` : ''} · running on the float model`;
  $('#hood').textContent = affect ? `${neuroLine}\n\naffect ${JSON.stringify(affect, null, 1)}\ndrives ${JSON.stringify(drives, null, 1)}\nurge to text you: ${urge}` : '';
  $('#summary').textContent = summary || '(no summary yet, it builds up as you talk)';
  $('#facts').innerHTML = '';
  for (const f of facts) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button>forget</button>';
    li.querySelector('span').textContent = f.text;
    li.querySelector('button').onclick = async () => drawMemory(await api(`/api/memory?id=${f.id}`, { method: 'DELETE' }));
    $('#facts').appendChild(li);
  }
  $('#followups').innerHTML = followups.length ? '' : '<li><span class="note">nothing yet</span></li>';
  for (const f of followups) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span>';
    li.querySelector('span').textContent = f.about;
    const s = document.createElement('small'); s.textContent = f.when; li.querySelector('span').appendChild(s);
    $('#followups').appendChild(li);
  }
}
async function loadMemory() { drawMemory(await api('/api/memory')); loadPeer().catch(() => {}); }

// ── brain-to-brain ──
let peer = null;
function drawPeer(p) {
  peer = p;
  const words = { 'not paired': 'Not paired with another friend.', off: 'Paired, but switched off on your side.',
    'waiting for the other side': `On. Waiting for ${p.theirName || 'the other side'} to switch on.`, active: `Active with ${p.theirName || 'the other friend'}.` };
  $('#peerStatus').textContent = `${words[p.state] || p.state}${p.state === 'active' ? ` ${p.sentToday + p.receivedToday} exchanges today, ${p.callsToday}/${p.callsBudget} AI calls.` : ''}${p.lastStatus ? `\nLast: ${p.lastStatus}` : ''}`;
  $('#peerToggle').textContent = p.enabled ? '🔗 Turn off brain-to-brain' : '🔗 Let him talk to the other friend';
  $('#peerToggle').disabled = !p.configured;
  if (document.activeElement !== $('#peerUrl')) $('#peerUrl').value = p.url || '';
  for (const k of ['1', '2', '3']) $(`#tier${k}`).checked = !!p.tiers?.[k];
  const log = $('#peerLog');
  log.innerHTML = '';
  for (const m of p.transcript || []) {
    const d = document.createElement('div');
    d.className = `peer ${m.direction}`;
    const small = document.createElement('small');
    small.textContent = `${m.who || ''} · ${m.when}${m.felt ? ` · ${m.felt}` : ''}`;
    const span = document.createElement('span');
    span.textContent = m.text;
    d.append(small, span);
    log.appendChild(d);
  }
}
async function loadPeer() { drawPeer(await api('/api/peer')); }
const savePeerSettings = async (body) => { await api('/api/peer/settings', { method: 'POST', body: JSON.stringify(body) }); await loadPeer(); };
$('#peerToggle').onclick = () => savePeerSettings({ enabled: !peer?.enabled });
$('#peerSave').onclick = () => savePeerSettings({ url: $('#peerUrl').value, ...($('#peerCode').value ? { code: $('#peerCode').value } : {}) });
for (const k of ['1', '2', '3']) $(`#tier${k}`).onchange = () => savePeerSettings({ tiers: { [k]: $(`#tier${k}`).checked } });
$('#memNow').onclick = async () => {
  $('#memNow').textContent = '🧠 Thinking…';
  try { drawMemory(await api('/api/memory', { method: 'POST' })); } finally { $('#memNow').textContent = '🧠 Update memory now'; }
};

// ── push notifications ──
function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

async function setupPushNote() {
  const note = $('#pushNote');
  if (!me?.pushKey) { note.textContent = 'Push keys not set up yet (run npm run vapid).'; $('#pushBtn').disabled = true; return; }
  if (isIOS && !standalone) { note.textContent = 'On iPhone: tap Share → "Add to Home Screen", open it from there, then tap this.'; return; }
  if (!('PushManager' in window)) { note.textContent = "This browser can't do notifications."; return; }
  note.textContent = Notification.permission === 'granted' ? 'On ✅' : '';
}
$('#pushBtn').onclick = async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ((await Notification.requestPermission()) !== 'granted') { $('#pushNote').textContent = 'Blocked. Allow notifications in your browser settings.'; return; }
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(me.pushKey) }));
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
    $('#pushNote').textContent = 'On ✅ He can text you first now.';
  } catch (e) { $('#pushNote').textContent = 'Failed: ' + e.message; }
};

// ── boot ──
async function start() {
  try { me = await api('/api/me'); } catch { return; }
  $('#app').hidden = false;
  setName(me.name);
  setMood(me.mood);
  $('#callBtn').hidden = !me.calls;   // calls stay hidden until switched on
  $('#handsfreeSetting').closest('label').hidden = !me.calls;
  $('#avatar').textContent = me.emoji || '💀';
  await loadAll();
  setupPushNote();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
setInterval(() => { if (!document.hidden && !busy && !$('#app').hidden) sync().catch(() => {}); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) sync().catch(() => {}); });
start();

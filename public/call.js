// ───────────────────────────────────────────────────────────────
//  LIVE CALLS. The phone talks to Gemini Live directly with a short-lived
//  token from the app (the real key never reaches the phone). One fresh,
//  pre-warmed session per turn, conversation carried as text (flat cost).
//  Push-to-talk by default; hands-free uses an on-phone voice detector so
//  silence is never sent. Every turn goes back to the app to be saved,
//  felt by the brain and costed.
// ───────────────────────────────────────────────────────────────
(() => {
  const $ = (s) => document.querySelector(s);
  const CRISIS = /\b(kill(ing)? myself|suicid\w*|end(ing)? it all|(wanna|want to|going to|gonna) die|don'?t want to (be here|live|exist)|no reason to (live|be here)|better off dead|hurt(ing)? myself|self[- ]?harm|cut(ting)? myself)\b/i;
  const RETRY_MS = 2000, MAX_RETRIES = 2;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const api = async (path, body) => {
    const r = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  };

  // ── UI ──
  const ui = document.createElement('div');
  ui.id = 'call'; ui.hidden = true;
  ui.innerHTML = `
    <div class="call-top"><div class="avatar big" id="callAvatar">💀</div><div id="callName"></div><div id="callMood" class="call-dim"></div>
      <div id="callStatus">connecting…</div><div id="callMeta" class="call-dim"></div></div>
    <div id="callCrisis" hidden>You can call or text <b>988</b> any time, day or night. It's free and it's a real person.<br>He's still here on the call with you.</div>
    <div id="callErr" class="call-dim"></div>
    <button id="talkBtn" class="talk">hold or tap to talk</button>
    <label class="call-row"><input type="checkbox" id="callHands"> hands-free</label>
    <button id="hangBtn" class="hang">hang up</button>`;
  document.body.appendChild(ui);
  const status = (t) => { $('#callStatus').textContent = t; };
  const err = (t) => { $('#callErr').textContent = t || ''; };

  // ── audio ──
  let ctx = null, mic = null, node = null, src = null;
  const WORKLET = `class Mic extends AudioWorkletProcessor {
    constructor(){ super(); this.step = sampleRate / 16000; this.t = 0; this.prev = 0; this.buf = new Int16Array(320); this.n = 0; }
    process(inputs){ const x = inputs[0] && inputs[0][0]; if (!x) return true;
      while (this.t < x.length) { const i = Math.floor(this.t), f = this.t - i;
        const a = i === 0 ? this.prev : x[i - 1], b = x[i]; const v = a + (b - a) * f;
        this.buf[this.n++] = Math.max(-1, Math.min(1, v)) * 32767;
        if (this.n === 320) { let e = 0; for (let k = 0; k < 320; k++) e += (this.buf[k] / 32768) ** 2;
          this.port.postMessage({ pcm: this.buf.buffer.slice(0), rms: Math.sqrt(e / 320) }); this.n = 0; }
        this.t += this.step; }
      this.t -= x.length; this.prev = x[x.length - 1]; return true; } }
    registerProcessor('mic16k', Mic);`;

  async function startAudio() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    src = ctx.createMediaStreamSource(mic);
    try {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
      node = new AudioWorkletNode(ctx, 'mic16k');
      node.port.onmessage = (e) => onFrame(new Int16Array(e.data.pcm), e.data.rms);
    } catch {
      // Older Safari: ScriptProcessor fallback, same 16 kHz / 20 ms frames.
      node = ctx.createScriptProcessor(2048, 1, 1);
      const step = ctx.sampleRate / 16000; let t = 0, prev = 0, buf = new Int16Array(320), n = 0;
      node.onaudioprocess = (e) => {
        const x = e.inputBuffer.getChannelData(0);
        while (t < x.length) { const i = Math.floor(t), f = t - i, a = i === 0 ? prev : x[i - 1], b = x[i];
          buf[n++] = Math.max(-1, Math.min(1, a + (b - a) * f)) * 32767;
          if (n === 320) { let s = 0; for (let k = 0; k < 320; k++) s += (buf[k] / 32768) ** 2; onFrame(buf.slice(0), Math.sqrt(s / 320)); n = 0; }
          t += step; }
        t -= x.length; prev = x[x.length - 1];
      };
    }
    const sink = ctx.createGain(); sink.gain.value = 0;          // keep the graph running, silently
    src.connect(node); node.connect(sink); sink.connect(ctx.destination);
  }
  function stopAudio() { try { mic?.getTracks().forEach((t) => t.stop()); src?.disconnect(); node?.disconnect(); } catch {} mic = src = node = null; }

  // Playback: 24 kHz PCM chunks scheduled back-to-back.
  let playing = [], playEnd = 0;
  function play(b64) {
    const bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; f[i] = v / 32768; }
    const buf = ctx.createBuffer(1, n, 24000); buf.copyToChannel(f, 0);
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, playEnd); s.start(at); playEnd = at + buf.duration;
    playing.push(s); s.onended = () => { playing = playing.filter((x) => x !== s); };
  }
  function stopPlayback() { for (const s of playing) { try { s.stop(); } catch {} } playing = []; playEnd = 0; }
  const isPlaying = () => ctx && playEnd > ctx.currentTime;
  const fillers = [];
  async function loadFillers() {
    for (let i = 1; i <= 3; i++) {
      try { const ab = await (await fetch(`/voice/filler-${i}.wav`)).arrayBuffer(); fillers.push(await ctx.decodeAudioData(ab)); } catch {}
    }
  }
  function playFiller() {
    if (!fillers.length) return;
    const s = ctx.createBufferSource(); s.buffer = fillers[Math.floor(Math.random() * fillers.length)]; s.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.01, playEnd); s.start(at); playEnd = at + s.buffer.duration; playing.push(s);
  }

  // ── sessions (one per turn, pre-warmed) ──
  let C = null;   // the current call
  function openSession() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(C.token)}`);
      const s = { ws, heard: '', said: '', usage: [], firstAudio: null, done: false, cancelled: false };
      const timer = setTimeout(() => reject(new Error('session setup timed out')), 6000);
      ws.onmessage = async (ev) => {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text());
        if (m.setupComplete) { clearTimeout(timer); resolve(s); return; }
        onServer(s, m);
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('could not reach the voice service')); };
      // Closed before it was ready (e.g. too many open sessions): fail loudly, never hang.
      ws.onclose = (e) => { clearTimeout(timer); s.closed = true; reject(new Error(`voice session closed (${e.code}${e.reason ? ` ${e.reason}` : ''})`)); if (C) log('session closed', e.code, e.reason || ''); };
      ws.onopen = () => ws.send(JSON.stringify({ setup: {
        model: `models/${C.model}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: C.voice } } } },
        systemInstruction: { parts: [{ text: C.system }] },
        inputAudioTranscription: {}, outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      } }));
    });
  }
  const spare = () => (C.spare ||= openSession().catch((e) => { log('spare failed:', e.message); return null; }));
  // Take the pre-warmed spare if it's still good, otherwise open a fresh one (up to 3 tries).
  async function takeSession() {
    let s = await spare(); C.spare = null;
    for (let i = 0; (!s || s.closed || s.ws.readyState !== 1) && i < 3; i++) {
      try { s = await openSession(); } catch (e) { log('open failed:', e.message); s = null; await new Promise((r) => setTimeout(r, 300)); }
    }
    if (!s) throw new Error("couldn't connect the call");
    spare();
    return s;
  }
  const send = (s, o) => { try { s.ws.send(JSON.stringify(o)); } catch {} };
  // An abandoned session (retry / crisis) was still billed: log its usage too.
  const reportAbandoned = (s) => setTimeout(() => { if (C && s.usage.length && !s.reported) { s.reported = true; api('/api/call/turn', { callId: C.id, usage: s.usage }).then((r) => { C.usd = r.callUsd; }).catch(() => {}); } }, 1500);
  const context = () => [...C.history.slice(-24), { role: 'user', parts: [{ text: `[note from the app, not from him: ${C.delivery}]` }] }];
  function streamUtterance(s, frames) {   // fast resend (retries, pre-roll)
    for (const f of frames) send(s, { realtimeInput: { audio: { data: b64(f), mimeType: 'audio/pcm;rate=16000' } } });
  }
  const b64 = (i16) => { let s = ''; const u = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

  const log = (...a) => { if (C) { C.log.push(`${Math.round(performance.now() - C.t0)}ms ${a.join(' ')}`); if (C.log.length > 80) C.log.shift(); } };
  const isCrisis = (t) => CRISIS.test(String(t || '').replace(/[‘’‛′`´]/g, "'"));   // curly apostrophes too
  const closeLater = (s) => setTimeout(() => { try { s.ws.close(); } catch {} }, 1600);
  // Drop every attempt of this turn except `keep` (their usage is still reported).
  function dropOthers(keep) { for (const o of C.attempts || []) if (o !== keep && !o.cancelled) { o.cancelled = true; reportAbandoned(o); closeLater(o); log('dropped attempt', o.n); } }

  function onServer(s, m) {
    if (m.usageMetadata) s.usage.push(m.usageMetadata);   // count usage even on cancelled sessions (it was billed)
    if (s.cancelled) return;
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) {
      s.heard += sc.inputTranscription.text;
      if (!C.crisisThisTurn && isCrisis(s.heard)) { log('crisis heard'); crisisNow(s); }
    }
    if (sc.outputTranscription?.text) s.said += sc.outputTranscription.text;
    for (const p of sc.modelTurn?.parts || []) {
      if (!p.inlineData?.data) continue;
      // Hedged turn: the first attempt to speak wins, the others are dropped.
      if (!C.winner) { C.winner = s; C.cur = s; dropOthers(s); log('first audio from attempt', s.n); }
      if (s !== C.winner) return;
      if (s.firstAudio == null) { s.firstAudio = performance.now(); clearTimeout(C.retryTimer); C.state = 'speaking'; status('talking'); }
      play(p.inlineData.data);
    }
    if (sc.turnComplete && (s === C.winner || (!C.winner && s === C.cur))) { log('turn complete', s.n); finishTurn(s, false); }
  }

  // ── the turn state machine ──
  async function startTalking() {
    if (!C || C.state === 'listening' || C.state === 'connecting') return;
    // Interrupt: talking over him cuts him off instantly.
    if (C.state === 'speaking' || C.state === 'waiting') {
      stopPlayback(); clearTimeout(C.retryTimer);
      log('interrupt');
      const was = C.winner || C.cur;
      dropOthers(was);
      if (was && !was.cancelled) { was.cancelled = true; closeLater(was); finishTurn(was, true); }
    }
    C.state = 'connecting'; status('…');
    let s;
    try { s = await takeSession(); } catch (e) { err(e.message); log('session failed', e.message); C.state = 'idle'; status('tap to talk'); return; }
    s.n = ++C.attemptNo; log('turn start on attempt', s.n);
    C.cur = s; C.attempts = [s]; C.winner = null; C.utt = []; C.retries = 0; C.crisisThisTurn = false;
    send(s, { clientContent: { turns: context(), turnComplete: false } });
    send(s, { realtimeInput: { activityStart: {} } });
    if (C.preroll?.length) { streamUtterance(s, C.preroll); C.utt.push(...C.preroll); C.preroll = []; }
    C.state = 'listening'; status('listening…'); $('#talkBtn').classList.add('on');
    if (C.stopWhenReady) { C.stopWhenReady = false; setTimeout(stopTalkingWithCrisis, 300); }
  }
  function stopTalking() {
    if (!C || C.state !== 'listening') return;
    $('#talkBtn').classList.remove('on');
    send(C.cur, { realtimeInput: { activityEnd: {} } });
    C.eos = performance.now(); C.state = 'waiting'; status('…');
    if (!C.utt.length) { C.state = 'idle'; status('tap to talk'); return; }
    armRetry();
  }
  function armRetry() {
    clearTimeout(C.retryTimer);
    C.retryTimer = setTimeout(async () => {
      if (!C || C.state !== 'waiting' || C.winner || C.crisisThisTurn) return;
      if (C.retries >= MAX_RETRIES) { log('gave up waiting'); status("line's slow… say it again?"); return; }
      C.retries++; C.totalRetries++;
      playFiller();                                              // "hm" while a second attempt races the first
      const s = await takeSession();
      if (!C || C.winner) { s.cancelled = true; closeLater(s); return; }
      s.n = ++C.attemptNo; s.heard = C.cur.heard; C.attempts.push(s);
      log('hedge attempt', s.n, `(${C.utt.length} frames)`);
      send(s, { clientContent: { turns: context(), turnComplete: false } });
      send(s, { realtimeInput: { activityStart: {} } }); streamUtterance(s, C.utt); send(s, { realtimeInput: { activityEnd: {} } });
      armRetry();
    }, RETRY_MS);
  }
  // Crisis: drop the normal reply, speak a sincere one right away, in his voice.
  async function crisisNow(s) {
    C.crisisThisTurn = true; C.crisis = true; $('#callCrisis').hidden = false;
    if (C.state === 'listening') return;          // wait for him to finish his sentence; handled on stop
    stopPlayback(); clearTimeout(C.retryTimer);
    const heard = s.heard;
    dropOthers(null);                             // drop every normal attempt of this turn
    const c = await takeSession(); c.n = ++C.attemptNo; c.heard = heard;
    C.cur = c; C.attempts = [c]; C.winner = null;
    log('crisis reply on attempt', c.n);
    send(c, { clientContent: { turns: [...C.history.slice(-24), { role: 'user', parts: [{ text: heard || '(he said something that sounded like he might hurt himself)' }] },
      { role: 'user', parts: [{ text: '[note from the app: what he just said sounds like he might hurt himself or not want to be here. No jokes. Say ONE or TWO short sentences only, slowly and sincerely: check on him directly, and tell him he can call or text 988 any time. Then stop and let him talk. (The number is also on his screen.)]' }] }], turnComplete: true } });
    C.state = 'waiting'; C.eos = C.eos || performance.now();
  }
  const origStop = stopTalking;
  function stopTalkingWithCrisis() { const s = C?.cur; origStop(); if (C?.crisisThisTurn && s) crisisNow(s); }

  async function finishTurn(s, interrupted) {
    if (s.reported) return; s.reported = true;
    if (s === C.cur && !interrupted) { C.state = 'idle'; setTimeout(() => { if (C && C.state === 'idle') status(C.mode === 'handsfree' ? 'listening for you…' : 'tap to talk'); }, Math.max(0, (playEnd - ctx.currentTime) * 1000)); }
    const heard = s.heard.trim(), said = s.said.trim();
    if (heard) C.history.push({ role: 'user', parts: [{ text: heard }] });
    if (said) C.history.push({ role: 'model', parts: [{ text: said + (interrupted ? '—' : '') }] });
    // Google sends the usage count just after "turn complete": wait for it (max 1.5 s) so cost is real.
    for (let i = 0; i < 30 && !s.usage.length && !interrupted; i++) await new Promise((r) => setTimeout(r, 50));
    if (!interrupted) { try { s.ws.close(); } catch {} }   // this turn is done: free the connection
    if (!heard && !said && !s.usage.length) return;
    const latencyMs = s.firstAudio && C.eos ? s.firstAudio - C.eos : undefined;
    try {
      const r = await api('/api/call/turn', { callId: C.id, heard, said, interrupted, usage: s.usage, latencyMs, retried: C.retries, crisisLocal: C.crisisThisTurn });
      C.delivery = r.delivery; C.usd = r.callUsd;
      if (r.mood) $('#callMood').textContent = `${r.mood.emoji} ${r.mood.word}`;
      if (r.crisis) $('#callCrisis').hidden = false;
      meta();
    } catch (e) { err(`couldn't save that turn (${e.message})`); }
  }
  function meta() { const secs = Math.round((Date.now() - C.started) / 1000); $('#callMeta').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · $${(C.usd || 0).toFixed(3)}`; }

  // ── mic frames: push-to-talk streams while listening; hands-free runs a voice detector ──
  let floor = 0.01, above = 0, below = 0;
  function onFrame(pcm, rms) {
    if (!C) return;
    if (C.state === 'listening') {
      send(C.cur, { realtimeInput: { audio: { data: b64(pcm), mimeType: 'audio/pcm;rate=16000' } } });
      C.utt.push(pcm);
    }
    if (C.mode !== 'handsfree') return;
    const talkingNow = C.state === 'listening';
    if (!talkingNow) { C.preroll = [...(C.preroll || []), pcm].slice(-15); floor = floor * 0.98 + rms * 0.02; }
    const startThr = Math.max(0.02, floor * 3) * (isPlaying() ? 2.2 : 1);   // harder to trigger over his own voice
    if (!talkingNow) {
      above = rms > startThr ? above + 1 : 0;
      if (above >= 3) { above = 0; startTalking(); }
    } else {
      below = rms < Math.max(0.012, floor * 2) ? below + 1 : 0;
      if (below >= 30) { below = 0; stopTalkingWithCrisis(); }     // ~600 ms of quiet = done
    }
  }

  // ── controls ──
  const btn = $('#talkBtn');
  let downAt = 0, tapMode = false;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!C || C.mode === 'handsfree') return;
    if (tapMode && C.state === 'listening') { tapMode = false; stopTalkingWithCrisis(); return; }
    downAt = Date.now(); startTalking(); });
  btn.addEventListener('pointerup', () => { if (!C || C.mode === 'handsfree') return;
    if (Date.now() - downAt < 350) { tapMode = true; return; }   // quick tap: keep listening until the next tap
    if (C.state === 'connecting') { C.stopWhenReady = true; return; }
    stopTalkingWithCrisis(); });
  $('#callHands').onchange = (e) => {
    const on = e.target.checked; store.set('callMode', on ? 'handsfree' : 'ptt');
    if (C) { C.mode = on ? 'handsfree' : 'ptt'; btn.textContent = on ? 'hands-free: just talk' : 'hold or tap to talk'; status(on ? 'listening for you…' : 'tap to talk'); }
  };
  $('#hangBtn').onclick = hangUp;

  async function open() {
    ui.hidden = false; err(''); $('#callCrisis').hidden = true; status('connecting…');
    const mode = store.get('callMode') === 'handsfree' ? 'handsfree' : 'ptt';
    $('#callHands').checked = mode === 'handsfree';
    btn.textContent = mode === 'handsfree' ? 'hands-free: just talk' : 'hold or tap to talk';
    try {
      await startAudio();                               // inside the tap: iOS requirement
      const r = await api('/api/call/start', { mode });
      C = { ...r, id: r.callId, mode, state: 'idle', history: r.history || [], started: Date.now(), usd: 0, totalRetries: 0, spare: null,
        log: [], t0: performance.now(), attemptNo: 0, attempts: [], winner: null };
      $('#callName').textContent = r.name || 'no name yet';
      $('#callMood').textContent = r.mood ? `${r.mood.emoji} ${r.mood.word}` : '';
      if (!fillers.length) loadFillers();
      spare();                                          // pre-warm the first turn
      status(mode === 'handsfree' ? 'listening for you…' : 'tap to talk');
      C.meter = setInterval(meta, 1000);
    } catch (e) { err(e.message); status('call failed'); stopAudio(); C = null; }
  }
  async function hangUp() {
    if (C) {
      clearInterval(C.meter); clearTimeout(C.retryTimer);
      // Hanging up must always work: never wait more than a moment on a stuck spare.
      const spareS = await Promise.race([C.spare, new Promise((r) => setTimeout(() => r(null), 300))]).catch(() => null);
      for (const s of [...(C.attempts || []), C.cur, spareS]) { try { s && s.ws.close(); } catch {} }
      try { const r = await api('/api/call/end', { callId: C.id }); status(`call ended · ${r.minutes ?? '?'} min · $${(r.usd ?? 0).toFixed(3)}`); } catch {}
    }
    stopPlayback(); stopAudio(); C = null;
    setTimeout(() => { ui.hidden = true; }, 900);
  }
  window.HomieCall = { open, hangUp, debug: () => ({ state: C?.state || null, playing: !!isPlaying(), speaking: C?.state === 'speaking', crisis: !!C?.crisis, retries: C?.totalRetries || 0, log: C?.log?.slice(-25) || [] }) };
})();

// ───────────────────────────────────────────────────────────────
//  NEURON SERVICE — runs on a PC (or a Pi later, unchanged).
//  Hosts one or more brains. Each brain is its own network, born and
//  screened separately, with its own state file, backups and sync channel
//  to its own app. Nothing is shared between brains.
//  Sync is outbound long-polling (no ports, no tunnel):
//    app -> here: message intensities (numbers only) + drives/energy
//    here -> app: the decoded readout of what the neurons settled into
//  usage: node neuro/service.mjs            (reads neuro/config.json)
//  config: { "brains": [ { "id", "workerUrl", "secret", "stickiness"?, "size"? } ], "backupDir"? }
//  (the older single-brain config { workerUrl, secret, ... } still works)
// ───────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize, deserialize, SMALL } from './snn.js';
import { learnedSummary } from './tools/learned.mjs';
import { birth, advanceTo, perceive, readout, applyChemistry } from './brain.mjs';

// A failed log write (D: dropping out) must not kill the brain. See keepalive.mjs.
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});

const here = dirname(fileURLToPath(import.meta.url));
// NEURO_CONFIG / NEURO_STATE_DIR let a test run use its own files, never the real ones.
const cfgPath = process.env.NEURO_CONFIG || join(here, 'config.json');
const stateDir = process.env.NEURO_STATE_DIR || join(here, 'state');
if (!existsSync(cfgPath)) {
  console.error('Missing neuro/config.json — run START-NEURONS.bat first.');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
// Only one service per brain set: two copies would overwrite each other's brains.
try {
  const st = JSON.parse(readFileSync(join(stateDir, 'status.json'), 'utf8'));
  if (st.pid && st.pid !== process.pid && Date.now() - st.at < 15000) {
    try { process.kill(st.pid, 0); console.error(`Neurons are already running (pid ${st.pid}). Not starting a second copy.`); process.exit(0); } catch { /* stale */ }
  }
} catch { /* no status yet */ }
const specs = cfg.brains || [{ id: 'main', workerUrl: cfg.workerUrl, secret: cfg.secret, stickiness: cfg.stickiness, size: cfg.size }];

function hostBrain(spec) {
  const id = spec.id;
  // The original single brain keeps its original file name.
  const statePath = join(stateDir, id === 'main' ? 'brain.json' : `brain-${id}.json`);
  const backupPath = cfg.backupDir ? join(cfg.backupDir, id === 'main' ? 'brain.json' : `brain-${id}.json`) : null;
  const log = (...a) => console.log(new Date().toLocaleTimeString(), `[${id}]`, ...a);

  function load() {
    for (const p of [statePath, backupPath]) {
      if (!p || !existsSync(p)) continue;
      try {
        const net = deserialize(readFileSync(p, 'utf8'));
        log(`loaded (born ${new Date(net.bornAt).toLocaleString()}, sim time ${(net.t / 1000).toFixed(0)}s)`);
        return net;
      } catch (e) { log(`could not read ${p}: ${e.message}`); }
    }
    log('no brain yet — wiring candidates (a minute or two)...');
    const net = birth({ opts: spec.size === 'small' ? SMALL : {}, log });
    net.realTs = Date.now();
    net.lastEventId = 0;
    return net;
  }

  function save(net) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath + '.tmp', serialize(net));
    renameSync(statePath + '.tmp', statePath);
    if (backupPath) {
      try { mkdirSync(cfg.backupDir, { recursive: true }); copyFileSync(statePath, backupPath); }
      catch (e) { log(`backup copy failed: ${e.message}`); }
    }
  }

  const net = load();
  if (spec.stickiness && net.p.stickiness !== spec.stickiness) {
    log(`stickiness ${net.p.stickiness ?? 1} → ${spec.stickiness}`);
    net.p = { ...net.p, stickiness: spec.stickiness };
  }
  save(net);
  let latest = null, lastSave = Date.now(), learned = null, learnedAt = 0;

  async function sync() {
    const res = await fetch(spec.workerUrl.replace(/\/$/, '') + '/api/neuro/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-neuro-secret': spec.secret },
      body: JSON.stringify({ readout: latest && learned ? { ...latest, learned } : latest, lastEventId: net.lastEventId || 0 }),
    });
    if (!res.ok) throw new Error(`sync ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async function loop() {
    log(`syncing with ${spec.workerUrl}`);
    while (!stopping) {
      try {
        const { events = [], chem } = await sync();
        handle.lastSync = Date.now();
        if (chem) applyChemistry(net, chem);
        for (const ev of events) {
          const gap = advanceTo(net, ev.ts, { maxSimMs: 20000 });
          if (net.realTs < ev.ts) net.realTs = ev.ts;
          const r = perceive(net, ev.appraisal || {});
          net.lastEventId = ev.id;
          latest = { ...r.readout, eventId: ev.id };
          log(`${ev.appraisal?.world ? 'found something' : 'message'} #${ev.id} → ${latest.dominant} (valence ${latest.valence}, dopamine ${latest.dopamine})${gap.blackoutMs ? `, blackout ${(gap.blackoutMs / 3600e3).toFixed(1)}h` : ''}`);
        }
        if (!events.length) {
          const { stats, simMs, blackoutMs } = advanceTo(net, Date.now(), { maxSimMs: 20000 });
          if (blackoutMs) log(`was off for a while: ${(blackoutMs / 3600e3).toFixed(1)}h blackout`);
          if (stats) latest = { ...readout(net, stats), eventId: net.lastEventId || 0 };
          if (simMs > 5000) log(`caught up ${(simMs / 1000).toFixed(0)} sim-s → ${latest?.dominant}`);
        }
        if (Date.now() - lastSave > 5 * 60e3) { save(net); lastSave = Date.now(); }
        // What its synapses have learned since birth (numbers only), for the self-model. Hourly.
        if (Date.now() - learnedAt > Number(process.env.NEURO_LEARNED_EVERY_MS || 3600e3)) { learned = learnedSummary(net); learnedAt = Date.now(); }
      } catch (e) {
        log(`sync failed (${e.message}); retrying in 15s`);
        advanceTo(net, Date.now(), { maxSimMs: 20000 });
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
  }
  const handle = { id, net, save, loop, lastSync: null };
  return handle;
}

let stopping = false;
const brains = specs.map(hostBrain);
// Exit 0 = stopped on purpose (the dashboard's STOP file): the keepalive stays down.
// A signal from anywhere else exits 3, so the keepalive brings the neurons back.
const shutdown = (why, code = 0) => { stopping = true; for (const b of brains) { try { b.save(b.net); } catch {} } console.log(`saved all brains, bye (${why})`); process.exit(code); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig, 3));
// The dashboard stops this hidden process by dropping a STOP file (Windows has
// no signals for windowless processes); brains are saved first.
const stopFile = join(stateDir, 'STOP');
setInterval(() => {
  if (existsSync(stopFile)) { try { rmSync(stopFile); } catch {} shutdown('stop requested'); }
  // Heartbeat for the dashboard: who's hosted and when each last synced.
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'status.json'), JSON.stringify({ pid: process.pid, ppid: process.ppid, at: Date.now(), brains: brains.map((b) => ({ id: b.id, lastSync: b.lastSync || null, born: b.net.bornAt })) }));
  } catch {}
}, 2000);
console.log(`hosting ${brains.length} brain(s): ${brains.map((b) => b.id).join(', ')}`);
for (const b of brains) b.loop();

// ───────────────────────────────────────────────────────────────
//  HOMIE DASHBOARD — one local page to run everything.
//  http://127.0.0.1:8790  (only reachable from this PC)
//  Starts things hidden (no console windows); logs go to dashboard/logs.
//  Closing the dashboard does NOT stop the neurons.
// ───────────────────────────────────────────────────────────────
import http from 'node:http';
import { spawn, exec, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790;
const logs = join(root, 'dashboard', 'logs');
mkdirSync(logs, { recursive: true });
const cfgPath = join(root, 'neuro', 'config.json');
const stateDir = join(root, 'neuro', 'state');
const statePath = join(root, 'dashboard', 'state.json');

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const dstate = () => readJson(statePath, {});
const saveDstate = (s) => writeFileSync(statePath, JSON.stringify(s, null, 2));
function brainsConfig() {
  const cfg = readJson(cfgPath, null);
  if (!cfg) return null;
  return cfg.brains ? cfg : { brains: [{ id: 'main', workerUrl: cfg.workerUrl, secret: cfg.secret, stickiness: cfg.stickiness, size: cfg.size }], backupDir: cfg.backupDir };
}
const mine = () => brainsConfig()?.brains.find((b) => b.id === 'main') || brainsConfig()?.brains[0] || null;
const openInBrowser = (url) => exec(`cmd /c start "" "${url}"`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── neuron service ──
function neuronStatus() {
  const st = readJson(join(stateDir, 'status.json'), null);
  const running = !!st && alive(st.pid) && Date.now() - st.at < 10000;
  return { running, pid: running ? st.pid : null, brains: running ? st.brains : [], note: 'runs hidden in the background; closing this page does not stop it' };
}
function startNeurons() {
  if (neuronStatus().running) return { ok: true, already: true };
  if (!existsSync(cfgPath)) return { ok: false, error: 'No neuro/config.json yet: run START-NEURONS.bat once to set it up.' };
  const out = openSync(join(logs, 'neurons.log'), 'a');
  const p = spawn(process.execPath, [join(root, 'neuro', 'keepalive.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  p.unref();
  return { ok: true, pid: p.pid };
}
async function stopNeurons() {
  const st = neuronStatus();
  if (!st.running) return { ok: true, already: true };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'STOP'), '1');          // service saves all brains, then exits
  for (let i = 0; i < 20 && alive(st.pid); i++) await sleep(500);
  // Forced fallback: take down the keepalive too, or it would restart the service.
  const s = readJson(join(stateDir, 'status.json'), {});
  if (alive(st.pid)) exec(`taskkill /pid ${s.ppid || st.pid} /T /F`);
  return { ok: true };
}

// ── local test Worker (wrangler dev) ──
async function localUp() { try { await fetch('http://127.0.0.1:8799/api/manifest', { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } }
function startLocal() {
  const s = dstate();
  if (s.localPid && alive(s.localPid)) return { ok: true, already: true };
  const out = openSync(join(logs, 'local-worker.log'), 'a');
  const p = spawn('npx wrangler dev --test-scheduled --port 8799', { cwd: root, shell: true, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  p.unref();
  saveDstate({ ...s, localPid: p.pid });
  return { ok: true, note: 'uses your real keys from .dev.vars (costs apply), http://localhost:8799' };
}
function stopLocal() {
  const s = dstate();
  if (s.localPid) exec(`taskkill /pid ${s.localPid} /T /F`);
  saveDstate({ ...s, localPid: null });
  return { ok: true };
}

// ── deploy (schema + code; secrets untouched: use DEPLOY.bat to change keys/password) ──
const jobs = {};
function deploy() {
  const id = Date.now().toString(36);
  const logFile = join(logs, `deploy-${id}.log`);
  const out = openSync(logFile, 'a');
  const p = spawn('node scripts/apply-schema.mjs && npx wrangler deploy', { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', out, out] });
  jobs[id] = { running: true, logFile };
  p.on('exit', (code) => { jobs[id].running = false; jobs[id].code = code; });
  return { ok: true, job: id };
}

// ── talking to my app (authorized by my brain's NEURO_SECRET) ──
async function myApp(path, body) {
  const b = mine();
  if (!b) throw new Error('no brain configured');
  const res = await fetch(b.workerUrl.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-neuro-secret': b.secret },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `app said ${res.status}`);
  return data;
}

// ── friends' brains ──
function addFriend({ id, url, secret }) {
  id = String(id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  url = String(url || '').trim();
  secret = String(secret || '').trim().replace(/^NEURO_SECRET=/, '');
  if (!id || id === 'main' || !/^https:\/\//.test(url) || secret.length < 20) return { ok: false, error: 'Need a short name, their https link, and their NEURO_SECRET line.' };
  const cfg = brainsConfig();
  if (!cfg) return { ok: false, error: 'Set up your own brain first.' };
  if (cfg.brains.some((b) => b.id === id)) return { ok: false, error: `"${id}" already exists.` };
  cfg.brains.push({ id, workerUrl: url, secret, stickiness: 1 });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return { ok: true };
}

// ── Windows conveniences ──
function makeShortcut(where, name, target) {
  const lnk = join(where, `${name}.lnk`).replace(/'/g, "''");
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}');$s.TargetPath='${target.replace(/'/g, "''")}';$s.WorkingDirectory='${root.replace(/'/g, "''")}';$s.Save()`;
  return new Promise((ok) => execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (e) => ok(e ? { ok: false, error: e.message } : { ok: true, path: lnk })));
}
const startupDir = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const desktopDir = join(homedir(), 'Desktop');

// ── status ──
async function status() {
  const b = mine();
  const cfg = brainsConfig();
  const [app, local] = await Promise.all([
    b ? myApp('/api/neuro/status').catch((e) => ({ error: e.message })) : Promise.resolve({ error: 'not set up' }),
    localUp(),
  ]);
  const neurons = neuronStatus();
  const friends = (cfg?.brains || []).filter((x) => x.id !== 'main').map((f) => {
    const hb = neurons.brains.find((h) => h.id === f.id);
    const file = join(stateDir, `brain-${f.id}.json`);
    return { id: f.id, url: f.workerUrl, born: existsSync(file), lastSyncSec: hb?.lastSync ? Math.round((Date.now() - hb.lastSync) / 1000) : null,
      state: !neurons.running ? 'neurons stopped' : !existsSync(file) ? 'waiting to be born (restart neurons)' : hb?.lastSync ? 'synced' : 'not synced yet' };
  });
  return {
    appUrl: b?.workerUrl || null, app, neurons, friends, localWorker: { up: local, url: 'http://localhost:8799' },
    startupNeurons: existsSync(join(startupDir, 'Homie Neurons.lnk')), desktopShortcut: existsSync(join(desktopDir, 'Homie Dashboard.lnk')),
  };
}

// ── http ──
const routes = {
  'GET /api/status': status,
  'POST /api/neurons/start': async () => startNeurons(),
  'POST /api/neurons/stop': stopNeurons,
  'POST /api/neurons/restart': async () => { await stopNeurons(); await sleep(800); return startNeurons(); },
  'POST /api/local/start': async () => startLocal(),
  'POST /api/local/stop': async () => stopLocal(),
  'POST /api/deploy': async () => deploy(),
  'GET /api/job': async (q) => { const j = jobs[q.get('id')]; return j ? { ...j, log: readFileSync(j.logFile, 'utf8').slice(-4000) } : { error: 'no such job' }; },
  'POST /api/friend': async (_, body) => addFriend(body),
  'POST /api/name': async (_, body) => myApp('/api/neuro/name', { name: body.name }),
  'POST /api/peer': async (_, body) => myApp('/api/neuro/peer', body),
  'POST /api/calls': async (_, body) => myApp('/api/neuro/calls', { enabled: !!body.enabled }),
  'GET /api/peer/transcript': async () => myApp('/api/neuro/peer-transcript'),
  'POST /api/paircode': async () => ({ code: randomBytes(12).toString('hex') }),
  'POST /api/open': async (_, body) => { const s = await status(); openInBrowser(body.local ? 'http://localhost:8799' : s.appUrl); return { ok: true }; },
  'POST /api/startup': async () => makeShortcut(startupDir, 'Homie Neurons', join(root, 'NEURONS-HIDDEN.vbs')),
  'POST /api/desktop': async () => makeShortcut(desktopDir, 'Homie Dashboard', join(root, 'DASHBOARD.vbs')),
  'POST /api/quit': async () => { setTimeout(() => process.exit(0), 300); return { ok: true }; },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(readFileSync(join(root, 'dashboard', 'index.html')));
  }
  const fn = routes[`${req.method} ${url.pathname}`];
  if (!fn) { res.writeHead(404); return res.end(); }
  let body = {};
  if (req.method === 'POST') { let s = ''; for await (const c of req) s += c; try { body = JSON.parse(s || '{}'); } catch {} }
  try {
    const out = await fn(url.searchParams, body);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
  } catch (e) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message }));
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { openInBrowser(`http://127.0.0.1:${PORT}`); process.exit(0); }  // already running: just open it
  throw e;
});
server.listen(PORT, '127.0.0.1', () => { if (!process.argv.includes('--no-open')) openInBrowser(`http://127.0.0.1:${PORT}`); });

// End-to-end brain-to-brain test: two local apps (A, B), one neuron service
// hosting both brains, paired with each other. Stand-in brain (no API keys),
// throwaway databases/brains. usage: node scripts/peer-test.mjs
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'homie-peer-'));
const procs = [];
let failed = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => `"${s}"`;
const inst = {
  A: { port: 8821, pass: 'pass-A', secret: 'neuro-A', vars: '--var USER_NAME:Alex' },
  B: { port: 8822, pass: 'pass-B', secret: 'neuro-B', vars: '--var USER_NAME:Sam' },
};
const PAIR = 'pair-code-test-1234567890';

function start(n) {
  const i = inst[n];
  const env = join(tmp, `${n}.env`);
  writeFileSync(env, `APP_PASSWORD=${i.pass}\nDEV=1\nNEURO_SECRET=${i.secret}\n`);
  const persist = join(tmp, `db-${n}`);
  execSync(`npx wrangler d1 execute homie --local --persist-to ${q(persist)} --file ${q(join(root, 'schema.sql'))}`, { cwd: root, stdio: 'ignore' });
  // No quiet hours for the test (it may be the middle of the night here).
  procs.push(spawn(`npx wrangler dev --port ${i.port} --persist-to ${q(persist)} --env-file ${q(env)} ${i.vars} --var QUIET_START:3 --var QUIET_END:3`, { cwd: root, shell: true, stdio: 'ignore' }));
}
async function api(n, path, body) {
  const i = inst[n];
  const res = await fetch(`http://127.0.0.1:${i.port}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: i.cookie || '' }, body: body ? JSON.stringify(body) : undefined });
  if (path === '/api/login') i.cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return res.json();
}
const status = (n) => fetch(`http://127.0.0.1:${inst[n].port}/api/neuro/status`, { headers: { 'x-neuro-secret': inst[n].secret } }).then((r) => r.json());
const tick = (n, force) => api(n, `/api/tick${force ? `?force=${force}` : ''}`);
const peer = (n) => api(n, '/api/peer');
const settings = (n, body) => api(n, '/api/peer/settings', body);
const awake = (n) => api(n, '/api/debug/warp?set=energy:0.7');
const count = (p, dir) => (p.transcript || []).filter((m) => !dir || m.direction === dir).length;

try {
  start('A'); start('B');
  for (const n of ['A', 'B']) { for (let k = 0; k < 90; k++) { try { await fetch(`http://127.0.0.1:${inst[n].port}/api/manifest`); break; } catch { await sleep(1000); } } }
  for (const n of ['A', 'B']) await api(n, '/api/login', { password: inst[n].pass });
  writeFileSync(join(tmp, 'neuro.json'), JSON.stringify({ brains: ['A', 'B'].map((n) => ({ id: n, workerUrl: `http://127.0.0.1:${inst[n].port}`, secret: inst[n].secret, size: 'small' })) }));
  procs.push(spawn('node', [join(root, 'neuro', 'service.mjs')], { cwd: root, env: { ...process.env, NEURO_CONFIG: join(tmp, 'neuro.json'), NEURO_STATE_DIR: join(tmp, 'brains') }, stdio: ['ignore', openSync(join(tmp, 'svc.log'), 'w'), 'ignore'] }));
  for (let k = 0; k < 120; k++) { const [a, b] = await Promise.all([status('A'), status('B')]); if (a.neuro?.online && b.neuro?.online) break; await sleep(2000); }
  for (const n of ['A', 'B']) { await api(n, '/api/chat', { text: 'hey' }); await awake(n); }

  // Off by default: nothing at all.
  check((await peer('A')).state === 'not paired' && (await tick('A', 'peer')).peer === undefined, 'off by default: not paired, no channel');

  // Pair both, only A switched on.
  await settings('A', { url: `http://127.0.0.1:${inst.B.port}`, code: PAIR, enabled: true });
  await settings('B', { url: `http://127.0.0.1:${inst.A.port}`, code: PAIR, enabled: false });
  await awake('A');
  const t1 = await tick('A', 'peer');
  check(/other side/.test(t1.peer || ''), 'one side on: waits for the other side, sends nothing', t1.peer);

  // Both on: a real exchange, felt on both sides, logged on both sides.
  await settings('B', { enabled: true });
  await settings('A', { enabled: true });           // hello → A learns B is on
  const bBefore = await status('B');
  await awake('A'); await awake('B');
  const t2 = await tick('A', 'peer');
  const [pa, pb, bAfter] = [await peer('A'), await peer('B'), await status('B')];
  check(t2.exchanged?.sent === true, 'both on: exchange happened', JSON.stringify(t2.exchanged || t2.peer));
  check(count(pa, 'out') === 1 && count(pa, 'in') === 1 && count(pb, 'in') === 1 && count(pb, 'out') === 1, 'transcript is symmetric: each side has both messages',
    `A out/in ${count(pa, 'out')}/${count(pa, 'in')}, B in/out ${count(pb, 'in')}/${count(pb, 'out')}`);
  check(bAfter.neuro.dominant !== null && bAfter.peer.callsToday > 0, "B's brain felt it (neuro synced, calls counted)", `B calls ${bAfter.peer.callsToday}, A calls ${pa.callsToday}`);

  // Off switch on B: A's next attempt is refused; nothing lands on B.
  await settings('B', { enabled: false });
  const bRowsBefore = count(await peer('B'));
  await awake('A');
  const t3 = await tick('A', 'peer');
  const bRowsAfter = count(await peer('B'));
  check(!t3.exchanged?.sent && bRowsAfter === bRowsBefore, 'B switched off: A refused, zero new rows on B', t3.peer || t3.exchanged?.reason);
  const t4 = await tick('A', 'peer');
  check(/other side/.test(t4.peer || ''), 'no residual traffic: A stops trying', t4.peer);

  // Off switch on A: B can't reach A either.
  await settings('B', { enabled: true });
  await settings('A', { enabled: false });
  const aRowsBefore = count(await peer('A'));
  await awake('B');
  const t5 = await tick('B', 'peer');
  check(!t5.exchanged?.sent && count(await peer('A')) === aRowsBefore, 'A switched off: B refused, zero new rows on A', t5.peer || t5.exchanged?.reason);

  // Crisis on B: interrupts immediately, both directions.
  await settings('A', { enabled: true });
  await settings('B', { enabled: true });
  await api('B', '/api/chat', { text: "honestly i don't want to be here anymore" });
  await awake('A'); await awake('B');
  const t6 = await tick('A', 'peer');
  check(!t6.exchanged?.sent && /crisis/.test(t6.exchanged?.reason || t6.peer || ''), "crisis on B: B refuses A's message", t6.exchanged?.reason || t6.peer);
  const t7 = await tick('B', 'peer');
  check(/crisis/.test(t7.peer || ''), 'crisis on B: B does not reach out either', t7.peer);

  // Crisis on A: A stops initiating.
  await api('A', '/api/chat', { text: "honestly i don't want to be here anymore" });
  const t8 = await tick('A', 'peer');
  check(/crisis/.test(t8.peer || ''), 'crisis on A: A stops too', t8.peer);

  // Sharing gate: untagged facts (no AI tagging in this test) are never reachable.
  const aShare = await api('A', '/api/debug/warp?share=1');
  check(/may not share anything/.test(aShare.prompt || '') && !/Alex/.test(aShare.prompt || ''), 'memory gate: untagged facts unreachable (default deny)', (aShare.prompt || '').slice(0, 60));
} catch (e) {
  console.error('ERROR', e.message); failed++;
} finally {
  for (const p of procs) { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch {} }
  await sleep(1500);
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failed ? `\n${failed} FAILED` : '\nALL BRAIN-TO-BRAIN TESTS PASSED');
  process.exit(failed ? 1 : 0);
}

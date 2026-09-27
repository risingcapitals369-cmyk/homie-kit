// Keeps the neuron service alive: restarts it 5 s after any unexpected exit and
// logs how it died. A deliberate stop (dashboard STOP file, or "already
// running") exits with code 0, and then this exits too.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The log lives on D:, which drops out now and then ("No such device"). A failed
// log write must never take the neurons down with it (likely cause of the silent
// deaths on 2026-09-26 at 3:21 PM and 11:55 PM).
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});
const log = (...a) => console.log(new Date().toLocaleTimeString(), '[keepalive]', ...a);
let restarts = 0;

function start() {
  const p = spawn(process.execPath, [join(here, 'service.mjs')], { stdio: 'inherit', windowsHide: true });
  const began = Date.now();
  p.on('exit', (code, signal) => {
    if (code === 0) { log('neurons stopped on purpose; keepalive exiting'); process.exit(0); }
    restarts = Date.now() - began > 60e3 ? 0 : restarts + 1;   // back off if it keeps dying fast
    const wait = Math.min(60e3, 5e3 * 2 ** Math.min(restarts, 4));
    log(`neurons died unexpectedly (code ${code}, signal ${signal}); restarting in ${wait / 1000}s`);
    setTimeout(start, wait);
  });
}
log('watching the neuron service');
start();

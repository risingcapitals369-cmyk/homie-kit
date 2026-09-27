// Tuning probe: how does the substrate actually behave with given params?
// usage: node neuro/tools/probe.mjs '{"jPlus":4.5}' "hostility:1000,off:3000,warmth:1000,off:3000"
import { createNetwork, run, setInput } from '../snn.js';

const opts = JSON.parse(process.argv[2] || '{}');
const script = (process.argv[3] || 'off:2000,hostility:1000,off:4000').split(',').map((s) => s.split(':'));
const net = createNetwork(opts);
const fmt = (s) => `E ${s.eRate.toFixed(1).padStart(5)}Hz I ${s.iRate.toFixed(0).padStart(3)}Hz | ${s.clusterRates.map((x) => x.toFixed(0).padStart(3)).join(' ')}`;
console.log(`N=${net.N} syn=${net.w.length} chan->clusters ${JSON.stringify(net.chanClusters)}`);
const t0 = performance.now();
let simMs = 0;
for (const [spec, msStr] of script) {
  const ms = Number(msStr);
  const [what, hz] = spec.split('@');
  setInput(net, what === 'off' ? {} : { [what]: Number(hz) || opts.hz || 60 });
  for (let done = 0; done < ms; done += 1000) {
    const s = run(net, Math.min(1000, ms - done), { plastic: !!opts.plastic, homeostasis: !!opts.homeo });
    console.log(`${(what + ' ' + (done / 1000 + 1) + 's').padEnd(16)} ${fmt(s)}`);
  }
  simMs += ms;
}
console.log(`${((performance.now() - t0) / (simMs / 1000)).toFixed(0)} ms CPU per sim-second`);

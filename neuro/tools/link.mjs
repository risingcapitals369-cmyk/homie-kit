// Does a learned link outlive the mood that made it?
// Evening: 5 roasts while warm (should strengthen warm->roast synapses).
// Then 72 real hours of silence with the body clock. Track, hourly:
//   link    = warm->hostility weight change, as % of what was learned
//   control = humor->hostility weight change (should stay ~0: separates memory from drift)
// Finally: does warmth partly wake the roast state, vs. an identical twin with no history?
// usage: node neuro/tools/link.mjs [hours] [seed]
import { createNetwork, run, setInput, modulate, calibrateDecoder, decode, cloneNetwork, SMALL, CHANNELS } from '../snn.js';
import { circadianEnergy } from '../../src/affect.js';

const hours = Number(process.argv[2] || 72);
const seed = Number(process.argv[3] || 7);
const extra = JSON.parse(process.argv[4] || '{}');
const net = createNetwork({ ...SMALL, seed, ...extra });
calibrateDecoder(net);
run(net, 2000, { plastic: false, homeostasis: false });
const twin = cloneNetwork(net);              // same brain, no roast history
const birthW = net.w.slice();

const cl = (ch) => net.chanClusters[CHANNELS.indexOf(ch)][0];
const H = cl('hostility'), W = cl('warmth'), U = cl('humor');
const groupMean = (n, from, to) => {
  let s = 0, c = 0;
  for (let k = 0; k < n.w.length; k++) {
    const pre = n.synPre[k], post = n.synPost[k];
    if (pre < n.nE && post < n.nE && n.cluster[pre] === from && n.cluster[post] === to) { s += (n.w[k] - birthW[k]) / birthW[k]; c++; }
  }
  return (100 * s) / c; // mean % change per synapse vs birth
};
// The association = how much warm->roast moved beyond the control link (humor->roast).
const assoc = (n) => groupMean(n, W, H) - groupMean(n, U, H);
const name = (s) => CHANNELS[net.chanClusters.findIndex((c) => c[0] === s.clusterRates.indexOf(Math.max(...s.clusterRates)))];

// Evening at 8pm: roasted 5 times while warm.
let clock = 20, energy = circadianEnergy(clock);
modulate(net, { energy, connection: 0.4, novelty: 0.5, play: 0.5 });
for (let i = 0; i < 5; i++) {
  setInput(net, { warmth: 60, contact: 30 }); run(net, 1000);
  setInput(net, {}); run(net, 3000);
  setInput(net, { hostility: 60 }); run(net, 400);   // the roast
  setInput(net, { warmth: 60 }); run(net, 600);      // ...and he's still warm about it
  setInput(net, {}); run(net, 5000);
}
clock += 50 / 60;
const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`.padStart(7);
console.log(`seed ${seed} ${JSON.stringify(extra)}: after 5 roasts-while-warm, association ${f(assoc(net))} (warm->roast ${f(groupMean(net, W, H))}, control ${f(groupMean(net, U, H))})`);

for (let h = 1; h <= hours; h++) {
  let s;
  for (let m = 0; m < 6; m++) {
    energy += (circadianEnergy((clock + m / 6) % 24) - energy) * (1 - Math.pow(0.5, (1 / 6) / 1.5));
    modulate(net, { energy, connection: Math.min(1, 0.3 + 0.022 * h), novelty: Math.min(1, 0.3 + 0.02 * h), play: Math.min(1, 0.4 + 0.02 * h) });
    s = run(net, 10000);
  }
  clock += 1;
  if (h <= 6 || h % 6 === 0) {
    console.log(`+${String(h).padStart(2)}h ${String(Math.floor(clock % 24)).padStart(2)}:00 | mood ${name(s).padEnd(13)} | association ${f(assoc(net))} | peak cluster ${Math.max(...s.clusterRates).toFixed(0)}Hz`);
  }
}

// Behavior: same warm message to this brain and to the twin. How much does the roast state stir?
const probe = (n) => {
  const c = cloneNetwork(n);
  modulate(c, { energy: 0.65 });
  setInput(c, {}); run(c, 2000, { plastic: false, homeostasis: false });
  setInput(c, { warmth: 40 }); const during = run(c, 500, { plastic: false, homeostasis: false });
  return during.clusterRates[H];
};
const twinBefore = cloneNetwork(twin);
advanceTwin(twinBefore);
function advanceTwin(t) { // twin lives the same 72h, minus the roasts
  let e = circadianEnergy(20), ck = 20 + 50 / 60;
  for (let h = 1; h <= hours; h++) for (let m = 0; m < 6; m++) {
    e += (circadianEnergy((ck + h - 1 + m / 6) % 24) - e) * (1 - Math.pow(0.5, (1 / 6) / 1.5));
    modulate(t, { energy: e, connection: Math.min(1, 0.3 + 0.022 * h), novelty: Math.min(1, 0.3 + 0.02 * h), play: Math.min(1, 0.4 + 0.02 * h) });
    run(t, 10000);
  }
}
console.log(`\nbehavior after ${hours}h: roast cluster fires ${probe(net).toFixed(1)} Hz during a warm message (twin with no history: ${probe(twinBefore).toFixed(1)} Hz)`);

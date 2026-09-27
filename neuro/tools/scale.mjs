// Does a bigger brain buy anything? Same seeds, same birth screening, same probe
// battery, same banter test at each size. Writes one JSON line of results.
// Scaling keeps each neuron's wiring the same (in-degree ~200 recurrent, ~15 input
// synapses), like SMALL does going down: only the NUMBER of neurons changes.
// usage: node neuro/tools/scale.mjs <2k|5k|10k> [birthSeedsFrom=1]
import { performance } from 'node:perf_hooks';
import { run, setInput, modulate, cloneNetwork, serialize, decode, CHANNELS } from '../snn.js';
import { birth, perceive, readout } from '../brain.mjs';

const SIZES = { '1k': 1000, '2k': 2000, '5k': 5000, '10k': 10000 };
const label = process.argv[2] || '2k';
const N = SIZES[label];
const seedFrom = Number(process.argv[3] || 1);
const nE = N * 0.8;
const opts = N === 2000 ? {} : { nE, nI: N * 0.2, pConn: 0.1 * 2000 / N, inTargets: Math.round(60 * nE / 1600) };
const out = { size: label, N, opts };
const frozen = { plastic: false, homeostasis: false };

// 1. Birth + screening time.
let t0 = performance.now();
const births = [];
const net = birth({ opts, seeds: Array.from({ length: 10 }, (_, i) => seedFrom + i), log: (m) => births.push(m) });
out.birthSec = +((performance.now() - t0) / 1000).toFixed(1);
out.birthLog = births;
out.seed = net.p.seed;

// 2. State file size.
out.fileMB = +(serialize(net).length / 1e6).toFixed(2);
out.synapses = net.w.length + net.inW.length;

// 3. CPU per simulated second (resting and while a message is landing).
const cpu = (inp) => {
  const n = cloneNetwork(net); setInput(n, inp); run(n, 500);
  const t = performance.now(); run(n, 5000); return (performance.now() - t) / 5;
};
out.cpuMsPerSimSec = { rest: +cpu({}).toFixed(0), stim: +cpu({ warmth: 60, contact: 30 }).toFixed(0) };
// Service runs 1 sim-s per real minute awake.
out.cpuPctAwake = +(out.cpuMsPerSimSec.rest / 60000 * 100).toFixed(2);

// 4. Richness: which inputs leave distinguishable states behind?
const inputs = [];
for (const ch of CHANNELS) for (const hz of [20, 40, 60]) inputs.push({ name: `${ch}@${hz}`, ch, hz, rates: { [ch]: hz } });
for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) inputs.push({ name: `${CHANNELS[i]}+${CHANNELS[j]}`, rates: { [CHANNELS[i]]: 40, [CHANNELS[j]]: 40 } });
const REPS = 5;
const rested = cloneNetwork(net); setInput(rested, {}); run(rested, 3000, frozen);
const trials = [];
t0 = performance.now();
for (let c = 0; c < inputs.length; c++) {
  for (let rep = 0; rep < REPS; rep++) {
    const n = cloneNetwork(rested); n.rng = (1000003 * (rep + 1) + 7919 * c) >>> 0;
    setInput(n, inputs[c].rates); run(n, 1000, frozen);
    setInput(n, {}); run(n, 1000, frozen);
    const s = run(n, 1000, frozen);
    const r = decode(net, s);
    const tot = s.clusterRates.reduce((a, b) => a + b, 0) || 1;
    trials.push({ c, app: [r.valence, r.tension, r.warmth, r.playfulness, r.irritation, r.arousal], shares: s.clusterRates.map((x) => x / tot), top: r.dominant });
  }
}
out.probeSec = +((performance.now() - t0) / 1000).toFixed(0);

// Leave-one-out nearest-centroid: how many of the 52 inputs can be told apart
// from the state they leave behind? Mutual information -> "distinguishable states".
function classify(key, classes) {
  const sub = trials.filter((t) => classes.includes(t.c));
  const conf = new Map(); let correct = 0;
  for (const t of sub) {
    let best = -1, bd = Infinity;
    for (const c of classes) {
      const mem = sub.filter((u) => u.c === c && u !== t);
      const cen = mem[0][key].map((_, d) => mem.reduce((s, u) => s + u[key][d], 0) / mem.length);
      const dist = cen.reduce((s, v, d) => s + (v - t[key][d]) ** 2, 0);
      if (dist < bd) { bd = dist; best = c; }
    }
    if (best === t.c) correct++;
    const k = `${t.c}>${best}`; conf.set(k, (conf.get(k) || 0) + 1);
  }
  const n = sub.length, px = 1 / classes.length, py = new Map();
  for (const [k, v] of conf) { const y = k.split('>')[1]; py.set(y, (py.get(y) || 0) + v / n); }
  let mi = 0;
  for (const [k, v] of conf) { const pxy = v / n; mi += pxy * Math.log2(pxy / (px * py.get(k.split('>')[1]))); }
  return { acc: +(correct / n).toFixed(3), states: +(2 ** mi).toFixed(1) };
}
const all = inputs.map((_, i) => i);
out.distinguishable = { appSees6: classify('app', all), substrate8: classify('shares', all), of: inputs.length };
// Intensity: can a 20 vs 40 vs 60 Hz version of the same channel be told apart?
const intens = CHANNELS.map((ch) => classify('app', inputs.map((x, i) => (x.ch === ch ? i : -1)).filter((i) => i >= 0)).acc);
out.intensityAcc = { mean: +(intens.reduce((a, b) => a + b, 0) / 8).toFixed(2), chance: 0.33, perChannel: Object.fromEntries(CHANNELS.map((ch, i) => [ch, intens[i]])) };
out.basinsReached = new Set(trials.map((t) => t.top)).size;
// Noise: spread of the valence readout between repeats of the same input.
const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
out.valenceNoiseSD = +(all.map((c) => sd(trials.filter((t) => t.c === c).map((t) => t.app[0]))).reduce((a, b) => a + b, 0) / all.length).toFixed(3);
// Effective dimensionality of the state cloud (participation ratio of class means, 8 shares).
{
  const means = all.map((c) => { const m = trials.filter((t) => t.c === c); return m[0].shares.map((_, d) => m.reduce((s, u) => s + u.shares[d], 0) / m.length); });
  const mu = means[0].map((_, d) => means.reduce((s, m) => s + m[d], 0) / means.length);
  const C = mu.map((_, i) => mu.map((_, j) => means.reduce((s, m) => s + (m[i] - mu[i]) * (m[j] - mu[j]), 0) / means.length));
  const tr = C.reduce((s, r, i) => s + r[i], 0);
  let tr2 = 0; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) tr2 += C[i][j] * C[j][i];
  out.effectiveDims = +(tr * tr / tr2).toFixed(2);
}

// 5. Learning speed: the banter test (same as banter2.mjs), rounds until a
// mid-warm roast (45 Hz) no longer hurts; twin (no roasts) as the control.
{
  const cl = (ch) => net.chanClusters[CHANNELS.indexOf(ch)][0];
  const H = cl('hostility'), W = cl('warmth');
  const learned = cloneNetwork(net), twin = cloneNetwork(net);
  for (const n of [learned, twin]) modulate(n, { energy: 0.65, connection: 0.4, novelty: 0.5, play: 0.5 });
  const WARM = { warmth: 1, valence: 0.8 }, ROAST = { hostility: 1, valence: -0.6 };
  const roastLands = (n) => {
    const c = cloneNetwork(n);
    for (const [inp, ms] of [[{ warmth: 60 }, 1000], [{}, 2000], [{ hostility: 45 }, 400], [{}, 3000]]) { setInput(c, inp); var last = run(c, ms, { plastic: false }); }
    const top = last.clusterRates.indexOf(Math.max(...last.clusterRates));
    return top === W ? 'warm' : top === H ? 'hurt' : 'other';
  };
  let learnedAt = null; const path = [];
  for (let i = 1; i <= 10; i++) {
    for (const [n, roast] of [[learned, true], [twin, false]]) {
      perceive(n, WARM); setInput(n, {}); run(n, 3000);
      if (roast) perceive(n, ROAST);
      perceive(n, WARM); setInput(n, {}); run(n, 5000);
    }
    const st = roastLands(learned); path.push(st);
    if (st === 'warm' && learnedAt == null) learnedAt = i;
  }
  const liveBreak = (n) => {
    const c = cloneNetwork(n);
    perceive(c, WARM); setInput(c, {}); run(c, 3000);
    for (let k = 1; k <= 10; k++) {
      const r = perceive(c, { hostility: 1, valence: -0.7 });
      setInput(c, {}); run(c, 2000);
      if (r.readout.valence < 0.4) return k;
    }
    return 'never';
  };
  out.banter = { roundsToLearn: learnedAt ?? 'not in 10', path: path.join(','), twinAfter10: roastLands(twin),
    stillHurtableAfterTexts: liveBreak(learned), twinHurtAfterTexts: liveBreak(twin) };
}
console.log(JSON.stringify(out));

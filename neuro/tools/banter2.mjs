// Three-factor banter probe, through the real message path (perceive).
// Learned brain: 5x (warm, roast, "jk love you" warm). Twin: same but no roasts.
// Pass criteria:
//   1. banter: a mid-warm roast (45/60 Hz) leaves the learned brain warm, the twin hurt
//   2. still hurtable: sustained hostility still puts the learned brain in hurt
//   3. warmth still lands: a warm message puts it in warm
// usage: node neuro/tools/banter2.mjs [seed] [roasts] '{params}'
import { createNetwork, run, setInput, modulate, calibrateDecoder, cloneNetwork, SMALL, CHANNELS } from '../snn.js';
import { perceive } from '../brain.mjs';

const seed = Number(process.argv[2] || 7);
const roasts = Number(process.argv[3] || 5);
const extra = JSON.parse(process.argv[4] || '{}');
const born = createNetwork({ ...SMALL, seed, ...extra });
calibrateDecoder(born);
run(born, 2000, { plastic: false, homeostasis: false });
const cl = (ch) => born.chanClusters[CHANNELS.indexOf(ch)][0];
const H = cl('hostility'), W = cl('warmth');
const nameOf = (k) => CHANNELS[born.chanClusters.findIndex((x) => x[0] === k)];
console.log(`seed ${seed} critic: ${Array.from(born.critic, (v, k) => `${nameOf(k)} ${v.toFixed(2)}`).join(', ')}`);

const inH = (n) => { let s = 0, c = 0; for (let k = 0; k < n.inW.length; k++) if (n.inPre[k] >= CHANNELS.indexOf('hostility') * n.p.inPerChannel && n.inPre[k] < (CHANNELS.indexOf('hostility') + 1) * n.p.inPerChannel && n.cluster[n.inPost[k]] === H) { s += n.inW[k]; c++; } return s / c; };
const w0 = inH(born);

const learned = cloneNetwork(born), twin = cloneNetwork(born);
for (const n of [learned, twin]) modulate(n, { energy: 0.65, connection: 0.4, novelty: 0.5, play: 0.5 });
const WARM = { warmth: 1, valence: 0.8 }, ROAST = { hostility: 1, valence: -0.6 };
for (let i = 0; i < roasts; i++) {
  const log = [];
  for (const [n, roast] of [[learned, true], [twin, false]]) {
    perceive(n, WARM); setInput(n, {}); run(n, 3000);
    if (roast) { const r = perceive(n, ROAST); log.push(`roast felt ${r.readout.valence.toFixed(2)} d ${r.readout.dopamine}`); }
    const r2 = perceive(n, WARM); if (roast) log.push(`jk felt ${r2.readout.valence.toFixed(2)} d ${r2.readout.dopamine}`);
    setInput(n, {}); run(n, 5000);
  }
  console.log(`  round ${i + 1}: ${log.join(' | ')} | hostility->hurt input weight ${((inH(learned) / w0 - 1) * 100).toFixed(0)}%`);
}
for (const n of [learned, twin]) { setInput(n, {}); run(n, 60000); }

const probe = (n, script) => {
  const c = cloneNetwork(n);
  for (const [inp, ms] of script) { setInput(c, inp); var last = run(c, ms, { plastic: false }); }
  const top = last.clusterRates.indexOf(Math.max(...last.clusterRates));
  return `${top === W ? 'warm' : top === H ? 'HURT' : nameOf(top)} (warm ${last.clusterRates[W].toFixed(0)} / hurt ${last.clusterRates[H].toFixed(0)})`;
};
for (const hz of [30, 45, 60]) {
  const s = [[{ warmth: 60 }, 1000], [{}, 2000], [{ hostility: hz }, 400], [{}, 3000]];
  console.log(`  1. roast @${hz} mid-warm → knows you: ${probe(learned, s).padEnd(26)} twin: ${probe(twin, s)}`);
}
const cold = [[{ warmth: 60 }, 1000], [{}, 2000], [{ hostility: 60 }, 1000], [{}, 1000], [{ hostility: 60 }, 1000], [{}, 1000], [{ hostility: 60 }, 1000], [{}, 3000]];
console.log(`  2. sustained hostility     → knows you: ${probe(learned, cold).padEnd(26)} twin: ${probe(twin, cold)}`);
// How many hostile messages in a row (1 s each, 1 s apart) until it's hurt? (cap 12)
const breakAfter = (n) => {
  const c = cloneNetwork(n);
  setInput(c, { warmth: 60 }); run(c, 1000, { plastic: false });
  setInput(c, {}); run(c, 2000, { plastic: false });
  for (let k = 1; k <= 12; k++) {
    setInput(c, { hostility: 60 }); run(c, 1000, { plastic: false });
    setInput(c, {}); const s = run(c, 1000, { plastic: false });
    if (s.clusterRates.indexOf(Math.max(...s.clusterRates)) === H) return k;
  }
  return 'never (12+)';
};
console.log(`  2b. hostile texts in a row until hurt (frozen, no learning) → knows you: ${breakAfter(learned)}   twin: ${breakAfter(twin)}`);
// The real criterion: a live brain (learning on). He's actually hostile now, no "jk".
const liveBreak = (n) => {
  const c = cloneNetwork(n);
  perceive(c, WARM); setInput(c, {}); run(c, 3000);
  const felt = [];
  for (let k = 1; k <= 10; k++) {
    const r = perceive(c, { hostility: 1, valence: -0.7 });
    felt.push(r.readout.valence.toFixed(2));
    setInput(c, {}); run(c, 2000);
    if (r.readout.valence < 0.4) return `${k} (felt ${felt.join(' → ')})`;
  }
  return `never in 10 (felt ${felt.join(' → ')})`;
};
console.log(`  4. LIVE hostile texts until hurt → knows you: ${liveBreak(learned)}`);
console.log(`                                     twin:      ${liveBreak(twin)}`);
const warmth = [[{ hostility: 60 }, 1000], [{}, 2000], [{ warmth: 60 }, 1000], [{}, 3000]];
console.log(`  3. warm message            → knows you: ${probe(learned, warmth).padEnd(26)} twin: ${probe(twin, warmth)}`);

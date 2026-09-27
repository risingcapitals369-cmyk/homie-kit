// Quick screen for a params set: (1) does warm->roast survive 5 roasts + 120 sim-s
// (~2 real hours)? (2) does a 60 s hostile dwell run away (rumination explosion)?
// usage: node neuro/tools/linkfast.mjs '{"scaleRate":0.02}' [seed]
import { createNetwork, run, setInput, modulate, cloneNetwork, SMALL, CHANNELS } from '../snn.js';

const opts = JSON.parse(process.argv[2] || '{}');
const seed = Number(process.argv[3] || 7);
const born = createNetwork({ ...SMALL, seed, ...opts });
run(born, 2000, { plastic: false, homeostasis: false });
const cl = (ch) => born.chanClusters[CHANNELS.indexOf(ch)][0];
const H = cl('hostility'), W = cl('warmth'), U = cl('humor');

function linkOf(n, w0, from, to) {
  let s = 0, c = 0;
  for (let k = 0; k < n.w.length; k++) {
    const pre = n.synPre[k], post = n.synPost[k];
    if (pre < n.nE && post < n.nE && n.cluster[pre] === from && n.cluster[post] === to) { s += (n.w[k] - w0[k]) / w0[k]; c++; }
  }
  return (100 * s / c).toFixed(1) + '%';
}

// (1) association
const a = cloneNetwork(born);
const w0 = a.w.slice();
modulate(a, { energy: 0.65, connection: 0.4, novelty: 0.5, play: 0.5 });
for (let i = 0; i < 5; i++) {
  setInput(a, { warmth: 60 }); run(a, 1000);
  setInput(a, {}); run(a, 3000);
  setInput(a, { hostility: 60 }); run(a, 400);
  setInput(a, { warmth: 60 }); run(a, 600);
  setInput(a, {}); run(a, 5000);
}
const right = `W->H ${linkOf(a, w0, W, H)} U->H ${linkOf(a, w0, U, H)}`;
setInput(a, {}); run(a, 120000);
console.log(`${JSON.stringify(opts)} seed ${seed}`);
console.log(`  link right after:  ${right}`);
console.log(`  link 2 real h later: W->H ${linkOf(a, w0, W, H)} U->H ${linkOf(a, w0, U, H)}  (W->W ${linkOf(a, w0, W, W)}, H->H ${linkOf(a, w0, H, H)})`);

// (2) runaway check
const b = cloneNetwork(born);
setInput(b, { hostility: 60 }); run(b, 1000);
setInput(b, {});
const rates = [];
for (let s = 0; s < 60; s++) { const st = run(b, 1000); if (s % 15 === 14) rates.push(st.clusterRates[H].toFixed(0)); }
console.log(`  hostile dwell cluster rate @15/30/45/60s: ${rates.join(' ')} Hz`);

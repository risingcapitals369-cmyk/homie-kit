// Does a brain that's been roasted-while-warm learn it's banter?
// Test: in a warm mood, roast it. Does it bounce back to warm (learned) or
// sink into hostility (twin)? Also reports the roast->warm link it learned.
// usage: node neuro/tools/banter.mjs [seed] [roasts] [settleSimMs] '{params}'
import { createNetwork, run, setInput, modulate, cloneNetwork, SMALL, CHANNELS } from '../snn.js';

const seed = Number(process.argv[2] || 7);
const roasts = Number(process.argv[3] || 5);
const settle = Number(process.argv[4] || 120000);
const extra = JSON.parse(process.argv[5] || '{}');
const born = createNetwork({ ...SMALL, seed, ...extra });
run(born, 2000, { plastic: false, homeostasis: false });
const cl = (ch) => born.chanClusters[CHANNELS.indexOf(ch)][0];
const H = cl('hostility'), W = cl('warmth'), U = cl('humor');
const w0 = born.w.slice();
const link = (n, from, to) => {
  let s = 0, c = 0;
  for (let k = 0; k < n.w.length; k++) {
    const pre = n.synPre[k], post = n.synPost[k];
    if (pre < n.nE && post < n.nE && n.cluster[pre] === from && n.cluster[post] === to) { s += (n.w[k] - w0[k]) / w0[k]; c++; }
  }
  return (100 * s) / c;
};

const learned = cloneNetwork(born), twin = cloneNetwork(born);
for (const n of [learned, twin]) modulate(n, { energy: 0.65, connection: 0.4, novelty: 0.5, play: 0.5 });
for (let i = 0; i < roasts; i++) {
  for (const [n, roast] of [[learned, true], [twin, false]]) {
    setInput(n, { warmth: 60 }); run(n, 1000);
    setInput(n, {}); run(n, 3000);
    if (roast) { setInput(n, { hostility: 60 }); run(n, 400); } else run(n, 400);
    setInput(n, { warmth: 60 }); run(n, 600);
    setInput(n, {}); run(n, 5000);
  }
}
for (const n of [learned, twin]) { setInput(n, {}); run(n, settle); }
const f = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
console.log(`seed ${seed}, ${roasts} roasts, settle ${settle / 60000} real h ${JSON.stringify(extra)}: roast->warm ${f(link(learned, H, W) - link(learned, H, U))} vs control; warm->roast ${f(link(learned, W, H) - link(learned, U, H))}`);

// The probe: warm mood, then a roast of a given strength. Where does it end up 3 s later?
for (const hz of [30, 45, 60]) {
  const out = [];
  for (const n of [learned, twin]) {
    const c = cloneNetwork(n);
    setInput(c, { warmth: 60 }); run(c, 1000, { plastic: false });
    setInput(c, {}); run(c, 2000, { plastic: false });
    setInput(c, { hostility: hz }); run(c, 400, { plastic: false });
    setInput(c, {}); const after = run(c, 3000, { plastic: false });
    const top = after.clusterRates.indexOf(Math.max(...after.clusterRates));
    out.push(`${top === W ? 'warm' : top === H ? 'HURT' : CHANNELS[born.chanClusters.findIndex((x) => x[0] === top)]} (warm ${after.clusterRates[W].toFixed(0)} / hurt ${after.clusterRates[H].toFixed(0)} Hz)`);
  }
  console.log(`  roast @${hz}Hz mid-warm → knows you: ${out[0].padEnd(30)} twin: ${out[1]}`);
}

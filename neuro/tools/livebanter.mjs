// Replays the live app's banter sequence straight into perceive(), with the
// same numeric payloads the Worker sends, under different chemistry, to find
// why learning stalls in the live path.
import { createNetwork, run, setInput, modulate, calibrateDecoder, cloneNetwork, SMALL, CHANNELS } from '../snn.js';
import { perceive } from '../brain.mjs';
import { heuristicAppraisal } from '../../src/affect.js';

const born = createNetwork({ ...SMALL, seed: 1 });
calibrateDecoder(born);
run(born, 2000, { plastic: false, homeostasis: false });
const H = born.chanClusters[CHANNELS.indexOf('hostility')][0];
const hc = CHANNELS.indexOf('hostility'), per = born.p.inPerChannel;
const hw = (n) => { let s = 0, c = 0; for (let k = 0; k < n.inW.length; k++) if (n.inPre[k] >= hc * per && n.inPre[k] < (hc + 1) * per && n.cluster[n.inPost[k]] === H) { s += n.inW[k]; c++; } return s / c; };
const w0 = hw(born);
const pay = (t) => { const a = heuristicAppraisal(t); return Object.fromEntries(['warmth', 'hostility', 'vulnerability', 'win', 'humor', 'novelty', 'boring', 'valence', 'intensity'].map((k) => [k, a[k]])); };
const WARM = pay('love you man, appreciate you fr'), ROAST = pay("shut up you're so annoying lol"), JK = pay('jk love you man, appreciate you fr');
console.log('roast payload', JSON.stringify(ROAST));

for (const [label, chem] of [['drained drives (novelty .05, play .05)', { novelty: 0.05, play: 0.05 }], ['fresh drives (novelty .5, play .5)', { novelty: 0.5, play: 0.5 }]]) {
  const n = cloneNetwork(born);
  modulate(n, { energy: 0.7, connection: 0.4, ...chem });
  const out = [];
  for (let r = 0; r < 8; r++) {
    perceive(n, WARM); run(n, 33);
    const ro = perceive(n, ROAST); run(n, 33);
    perceive(n, JK); run(n, 60);
    out.push(`${ro.readout.dominant.slice(0, 4)} ${((hw(n) / w0 - 1) * 100).toFixed(0)}%`);
  }
  console.log(`${label}, plasticity ${n.mod.plasticity.toFixed(2)}: ${out.join(' | ')}`);
}

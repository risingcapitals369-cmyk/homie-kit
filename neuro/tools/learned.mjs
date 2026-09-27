// What has this brain learned since birth, grouped the way learning actually
// happens: per (input channel -> cluster) and per (cluster -> cluster).
// Birth arrays are regenerated from the seed (same-brain.mjs proves that's exact).
// usage: node neuro/tools/learned.mjs <brain.json>
import { readFileSync } from 'node:fs';
import { deserialize, createNetwork, CHANNELS } from '../snn.js';

export function learnedGroups(net) {
  const born = createNetwork({ ...net.p });
  const K = net.K, C = CHANNELS.length, per = net.p.inPerChannel;
  const inNow = Array.from({ length: C }, () => new Float64Array(K)), inBorn = inNow.map(() => new Float64Array(K));
  for (let s = 0; s < net.inW.length; s++) {
    const ch = Math.floor(net.inPre[s] / per), k = net.cluster[net.inPost[s]];
    inNow[ch][k] += net.inW[s]; inBorn[ch][k] += born.inW[s];
  }
  const recNow = Array.from({ length: K }, () => new Float64Array(K)), recBorn = recNow.map(() => new Float64Array(K));
  for (let s = 0; s < net.w.length; s++) {
    const i = net.synPre[s], j = net.synPost[s];
    if (i >= net.nE || j >= net.nE) continue;
    recNow[net.cluster[i]][net.cluster[j]] += net.w[s]; recBorn[net.cluster[i]][net.cluster[j]] += born.w[s];
  }
  const biasD = new Float64Array(K), cnt = new Float64Array(K);
  for (let i = 0; i < net.nE; i++) { biasD[net.cluster[i]] += net.bias[i] - born.bias[i]; cnt[net.cluster[i]]++; }
  return {
    sensory: inNow.map((row, ch) => Array.from(row, (v, k) => (inBorn[ch][k] ? v / inBorn[ch][k] : 1))),
    recurrent: recNow.map((row, i) => Array.from(row, (v, j) => (recBorn[i][j] ? v / recBorn[i][j] : 1))),
    biasDelta: Array.from(biasD, (v, k) => v / cnt[k]),
  };
}

// Compact, numbers-only version for the Worker's self-model (sent hourly).
// Per channel: its sensory pathway into its own cluster, how strongly that
// cluster re-excites itself (mood holding power), excitability drift. 1 = as born.
export function learnedSummary(net) {
  const g = learnedGroups(net);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const out = { sensory: {}, selfHold: {}, excite: {}, simHours: r3(net.t / 3600e3), at: Date.now() };
  CHANNELS.forEach((ch, c) => {
    const k = net.chanClusters[c][0];
    out.sensory[ch] = r3(g.sensory[c][k]);
    out.selfHold[ch] = r3(g.recurrent[k][k]);
    out.excite[ch] = r3(g.biasDelta[k]);
  });
  return out;
}

if (process.argv[1]?.endsWith('learned.mjs')) {
  const net = deserialize(readFileSync(process.argv[2], 'utf8'));
  const g = learnedGroups(net);
  const nameOf = (k) => CHANNELS[net.chanClusters.findIndex((c) => c[0] === k)] || `c${k}`;
  const pct = (x) => `${x >= 1 ? '+' : ''}${((x - 1) * 100).toFixed(1)}%`;
  console.log(`seed ${net.p.seed}, ${(net.t / 1000 / 3600).toFixed(1)} sim-hours lived, last event #${net.lastEventId}`);
  console.log('sensory (channel -> its own cluster):', CHANNELS.map((ch, c) => `${ch} ${pct(g.sensory[c][net.chanClusters[c][0]])}`).join(', '));
  let big = [];
  g.sensory.forEach((row, c) => row.forEach((x, k) => big.push([Math.abs(x - 1), `${CHANNELS[c]}->${nameOf(k)} ${pct(x)}`])));
  console.log('largest sensory changes:', big.sort((a, b) => b[0] - a[0]).slice(0, 6).map((x) => x[1]).join(', '));
  big = [];
  g.recurrent.forEach((row, i) => row.forEach((x, j) => big.push([Math.abs(x - 1), `${nameOf(i)}->${nameOf(j)} ${pct(x)}`])));
  console.log('largest recurrent changes:', big.sort((a, b) => b[0] - a[0]).slice(0, 6).map((x) => x[1]).join(', '));
  console.log('excitability drift per cluster:', g.biasDelta.map((v, k) => `${nameOf(k)} ${v.toFixed(2)}`).join(', '));
}

// Carry what a brain has learned into a freshly born one (any size).
// Approximate by design: learning here happens per (input channel -> cluster)
// and per (cluster -> cluster), and every cluster is the home of exactly one
// channel in every brain, so the old brain's learned GROUP strengths (relative
// to its own birth) are applied to the new brain's matching groups. Individual
// synapses don't carry over (they don't exist in the new wiring); the group
// averages do. Also carries excitability drift, the scaling set points, and
// the bookkeeping the service needs (which messages it has already felt).
import { learnedGroups } from './tools/learned.mjs';

export function migrate(old, fresh) {
  const g = learnedGroups(old);
  // new cluster -> the old cluster that was home to the same channel
  const toOld = Array.from({ length: fresh.K }, (_, k) => old.chanClusters[fresh.chanClusters.findIndex((c) => c[0] === k)][0]);
  const per = fresh.p.inPerChannel, { p } = fresh;

  for (let s = 0; s < fresh.inW.length; s++) {
    const ch = Math.floor(fresh.inPre[s] / per), k = toOld[fresh.cluster[fresh.inPost[s]]];
    fresh.inW[s] = Math.min(p.inWMax, fresh.inW[s] * g.sensory[ch][k]);
  }
  for (let s = 0; s < fresh.w.length; s++) {
    const i = fresh.synPre[s], j = fresh.synPost[s];
    if (i >= fresh.nE || j >= fresh.nE) continue;
    fresh.w[s] = Math.min(p.wMax, fresh.w[s] * g.recurrent[toOld[fresh.cluster[i]]][toOld[fresh.cluster[j]]]);
  }
  // Scaling set points (ratio to birth), per cluster, so synaptic scaling
  // doesn't pull the migrated recurrent weights straight back to birth.
  const tr = new Float64Array(old.K), n = new Float64Array(old.K);
  for (let i = 0; i < old.nE; i++) { tr[old.cluster[i]] += old.inTarget[i] / old.inTarget0[i]; n[old.cluster[i]]++; }
  for (let i = 0; i < fresh.nE; i++) {
    const k = toOld[fresh.cluster[i]];
    fresh.inTarget[i] = fresh.inTarget0[i] * (tr[k] / n[k]);
    fresh.bias[i] = Math.max(p.biasMin, Math.min(p.biasMax, fresh.bias[i] + g.biasDelta[k]));
  }
  for (const key of ['realTs', 'lastEventId', 'lastFelt']) if (old[key] != null) fresh[key] = old[key];
  fresh.mod = { ...old.mod };
  fresh.p = { ...fresh.p, stickiness: old.p.stickiness };
  fresh.migratedFrom = { N: old.N, seed: old.p.seed, bornAt: old.bornAt, at: Date.now(), simMsLived: old.t };
  return fresh;
}

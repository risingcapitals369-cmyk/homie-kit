// Is brain B the same brain as A (same birth), and what did A learn since?
// usage: node neuro/tools/same-brain.mjs <old.json> <new.json>
import { readFileSync } from 'node:fs';
import { deserialize } from '../snn.js';

const [A, B] = process.argv.slice(2).map((p) => deserialize(readFileSync(p, 'utf8')));
const eq = (x, y) => {
  if (ArrayBuffer.isView(x)) return x.length === y.length && x.every((v, i) => v === y[i]);
  return JSON.stringify(x) === JSON.stringify(y);
};
// Fixed at birth: never changed by living.
const FIXED = ['a', 'b', 'c', 'd', 'cluster', 'synPre', 'synPost', 'outStart', 'inStart', 'inSyn', 'inPre', 'inPost',
  'inOutStart', 'inInStart', 'inInSyn', 'inTarget0', 'target', 'chanClusters', 'critic', 'decoder'];
let same = true;
for (const k of FIXED) {
  const ok = eq(A[k], B[k]);
  if (!ok) same = false;
  console.log(`${ok ? 'identical' : 'DIFFERENT'}  ${k}`);
}
console.log(`birth seed: old ${A.p.seed}, new ${B.p.seed}`);
// Changed by living (what the old brain learned since birth).
const drift = (x, y) => { let d = 0, n = 0; for (let i = 0; i < x.length; i++) { d += Math.abs(x[i] - y[i]); n++; } return d / n; };
console.log(`\nlearned since birth (old vs fresh): recurrent weights avg |Δ| ${drift(A.w, B.w).toExponential(2)}, sensory weights ${drift(A.inW, B.inW).toExponential(2)}, excitability ${drift(A.bias, B.bias).toExponential(2)}`);
console.log(`old brain: ${(A.t / 1000).toFixed(0)} sim-s lived, last message #${A.lastEventId}; new brain: ${(B.t / 1000).toFixed(0)} sim-s, #${B.lastEventId}`);
console.log(same ? '\nSAME BRAIN: identical birth, the only difference is what the old one lived.' : '\nNOT THE SAME BIRTH.');

// How hard does a text have to hit to replace the mood it's in? Fresh brain (live
// birth), put it in a basin with one strong text, 30 min later a second text on
// another channel at a range of strengths: where does it land, and is it still
// there an hour later?
// usage: node neuro/tools/capture.mjs [fromChannel=humor] [toChannel=boring]
import { run, setInput, cloneNetwork } from '../snn.js';
import { birth, perceive, sharesByName } from '../brain.mjs';

const from = process.argv[2] || 'humor', to = process.argv[3] || 'boring';
const born = birth({ opts: {}, log: () => {} });
const top = (s) => Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
const base = cloneNetwork(born);
perceive(base, { [from]: 0.9 });
setInput(base, {}); run(base, 30000);
for (const x of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9]) {
  for (const scale of [0.6, 0.2, 0]) {
    const n = cloneNetwork(base);
    const r = perceive(n, { [to]: x, importance: scale });
    const landed = top(sharesByName(n, r.after.clusterRates));
    setInput(n, {}); const later = top(sharesByName(n, run(n, 60000).clusterRates));
    console.log(`${to} ${x} (importance ${scale}) → lands ${landed.padEnd(13)} 1h later ${later}`);
  }
}

// Does migration carry learning? Teach a 2k brain banter (the scale.mjs test),
// migrate it into a freshly born brain of the target size, and compare the
// migrated brain against the same new brain untaught.
// usage: node neuro/tools/migrate-test.mjs <2k|5k|10k>
import { run, setInput, modulate, cloneNetwork, CHANNELS } from '../snn.js';
import { birth, perceive } from '../brain.mjs';
import { migrate } from '../migrate.mjs';

const N = { '2k': 2000, '5k': 5000, '10k': 10000 }[process.argv[2] || '5k'];
const optsFor = (n) => (n === 2000 ? {} : { nE: n * 0.8, nI: n * 0.2, pConn: 0.1 * 2000 / n, inTargets: Math.round(60 * n * 0.8 / 1600) });
const WARM = { warmth: 1, valence: 0.8 }, ROAST = { hostility: 1, valence: -0.6 };

// A mid-warm roast at 30/45/60 Hz: where does it leave the brain, and by what margin?
const roastTest = (n) => {
  const W = n.chanClusters[CHANNELS.indexOf('warmth')][0], H = n.chanClusters[CHANNELS.indexOf('hostility')][0];
  return [30, 45, 60].map((hz) => {
    const c = cloneNetwork(n);
    for (const [inp, ms] of [[{ warmth: 60 }, 1000], [{}, 2000], [{ hostility: hz }, 400], [{}, 3000]]) { setInput(c, inp); var last = run(c, ms, { plastic: false }); }
    const cr = last.clusterRates, top = cr.indexOf(Math.max(...cr));
    return `${hz}Hz:${top === W ? 'warm' : top === H ? 'HURT' : 'other'}(${(cr[W] - cr[H]).toFixed(0)})`;
  }).join(' ');
};
const liveBreak = (n) => {
  const c = cloneNetwork(n);
  perceive(c, WARM); setInput(c, {}); run(c, 3000);
  for (let k = 1; k <= 10; k++) { const r = perceive(c, { hostility: 1, valence: -0.7 }); setInput(c, {}); run(c, 2000); if (r.readout.valence < 0.4) return k; }
  return 'never';
};

const small = birth({ opts: {}, log: () => {} });
const taught = cloneNetwork(small);
modulate(taught, { energy: 0.65, connection: 0.4, novelty: 0.5, play: 0.5 });
for (let i = 0; i < 10; i++) { perceive(taught, WARM); setInput(taught, {}); run(taught, 3000); perceive(taught, ROAST); perceive(taught, WARM); setInput(taught, {}); run(taught, 5000); }
console.log(`2k taught (source)     roast: ${roastTest(taught)} | hostile texts to hurt: ${liveBreak(taught)}`);
console.log(`2k untaught            roast: ${roastTest(small)}`);

const big = birth({ opts: optsFor(N), log: () => {} });
modulate(big, { energy: 0.65, connection: 0.4, novelty: 0.5, play: 0.5 });
const moved = migrate(taught, cloneNetwork(big));
console.log(`${process.argv[2]} untaught (seed ${big.p.seed}) roast: ${roastTest(big)} | hostile texts to hurt: ${liveBreak(big)}`);
console.log(`${process.argv[2]} MIGRATED            roast: ${roastTest(moved)} | hostile texts to hurt: ${liveBreak(moved)}`);
// Does it hold? Live on for 10 sim-minutes (10 real hours) of silence, then test again.
setInput(moved, {}); run(moved, 600000); setInput(big, {}); run(big, 600000);
console.log(`after 10h of silence:  untaught ${roastTest(big)} | MIGRATED ${roastTest(moved)}`);

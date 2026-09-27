// Debug: does weak warmth lift a fresh vs. entrenched hostile mood? (seed, hz)
import { createNetwork, run, setInput, cloneNetwork, CHANNELS, SMALL } from '../snn.js';

const seed = Number(process.argv[2] || 7);
const born = createNetwork({ ...SMALL, seed });
run(born, 3000, { plastic: false, homeostasis: false });
const cl = (ch) => born.chanClusters[CHANNELS.indexOf(ch)][0];
const top = (s) => s.clusterRates.indexOf(Math.max(...s.clusterRates));
console.log(`seed ${seed}: hostility=${cl('hostility')} warmth=${cl('warmth')}`);
for (const dwell of [1000, 60000]) {
  for (const hz of [10, 15, 20, 30, 45]) {
    const net = cloneNetwork(born);
    setInput(net, { hostility: 60 }); run(net, 1000);
    setInput(net, {}); run(net, dwell);
    setInput(net, { warmth: hz }); const during = run(net, 500);
    setInput(net, {}); const after = run(net, 2000);
    console.log(`dwell ${String(dwell).padStart(5)} warmth@${hz}: during top=${top(during)} after top=${top(after)} (${after.clusterRates.map((x) => x.toFixed(0)).join(' ')})`);
  }
}

// Debug: during a "roast while warm", does the roast cluster fire, and does warm->roast potentiate?
import { createNetwork, run, setInput, modulate, calibrateDecoder, SMALL, CHANNELS } from '../snn.js';

const seed = Number(process.argv[2] || 7);
const net = createNetwork({ ...SMALL, seed });
calibrateDecoder(net);
run(net, 2000, { plastic: false, homeostasis: false });
const birthW = net.w.slice();
const cl = (ch) => net.chanClusters[CHANNELS.indexOf(ch)][0];
const H = cl('hostility'), W = cl('warmth'), U = cl('humor');
const link = (from, to) => {
  let s = 0, c = 0;
  for (let k = 0; k < net.w.length; k++) {
    const pre = net.synPre[k], post = net.synPost[k];
    if (pre < net.nE && post < net.nE && net.cluster[pre] === from && net.cluster[post] === to) { s += net.w[k] - birthW[k]; c++; }
  }
  return (s / c).toFixed(5);
};
const show = (label, s) => console.log(`${label.padEnd(22)} warm ${s.clusterRates[W].toFixed(0).padStart(3)} roast ${s.clusterRates[H].toFixed(0).padStart(3)} humor ${s.clusterRates[U].toFixed(0).padStart(3)} | W->H ${link(W, H)} U->H ${link(U, H)}`);

modulate(net, { energy: 0.65, connection: 0.4, novelty: 0.5, play: 0.5 });
const variant = process.argv[3] || 'mixed';
for (let i = 0; i < 3; i++) {
  setInput(net, { warmth: 60, contact: 30 }); show('warm', run(net, 1000));
  setInput(net, {}); show('  settle', run(net, 3000));
  if (variant === 'mixed') { setInput(net, { hostility: 40, humor: 20 }); show('  roast(+humor)', run(net, 400)); setInput(net, { warmth: 40 }); show('  warm again', run(net, 600)); }
  else { setInput(net, { hostility: 60 }); show('  roast', run(net, 400)); }
  setInput(net, {}); show('  after', run(net, 5000));
}

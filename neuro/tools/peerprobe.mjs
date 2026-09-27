// Probe: does a peer message (no contact channel, mood contagion) move the
// receiving brain, and does a peer banter pattern get learned?
import { createNetwork, run, setInput, modulate, calibrateDecoder, cloneNetwork, decode, SMALL, CHANNELS } from '../snn.js';
import { perceive } from '../brain.mjs';
import { withContagion, heuristicAppraisal } from '../../src/affect.js';

const seed = Number(process.argv[2] || 7);
const born = createNetwork({ ...SMALL, seed });
calibrateDecoder(born);
run(born, 2000, { plastic: false, homeostasis: false });
const H = born.chanClusters[CHANNELS.indexOf('hostility')][0], W = born.chanClusters[CHANNELS.indexOf('warmth')][0];
const nameOf = (k) => CHANNELS[born.chanClusters.findIndex((x) => x[0] === k)];
const top = (s) => s.clusterRates.indexOf(Math.max(...s.clusterRates));
const hc = CHANNELS.indexOf('hostility'), per = born.p.inPerChannel;
const hw = (n) => { let s = 0, c = 0; for (let k = 0; k < n.inW.length; k++) if (n.inPre[k] >= hc * per && n.inPre[k] < (hc + 1) * per && n.cluster[n.inPost[k]] === H) { s += n.inW[k]; c++; } return s / c; };
const peerMsg = (text, mood) => ({ ...withContagion(heuristicAppraisal(text), mood), peer: true });
const warmMood = { valence: 0.85, warmth: 0.8, playfulness: 0.7, irritation: 0.1, tension: 0.1 };
const saltyMood = { valence: 0.2, warmth: 0.2, playfulness: 0.3, irritation: 0.8, tension: 0.5 };
const neutralMood = { valence: 0.5, warmth: 0.3, playfulness: 0.3, irritation: 0.3, tension: 0.2 };
const settleWarm = (n) => { setInput(n, { warmth: 60 }); run(n, 1000, { plastic: false }); setInput(n, {}); run(n, 2000, { plastic: false }); };

// 1. Does one message move B? Start both settled warm; message one, not the other.
const control = cloneNetwork(born), hit = cloneNetwork(born), kind = cloneNetwork(born);
for (const n of [control, hit, kind]) { modulate(n, { energy: 0.7, connection: 0.4, novelty: 0.4, play: 0.4 }); settleWarm(n); }
run(control, 2000);
const r = perceive(hit, peerMsg("shut up you're so annoying", saltyMood));
const rk = perceive(kind, peerMsg('love you man, appreciate you fr', warmMood));
const c = decode(control, run(control, 1000, { plastic: false }));
console.log(`1. from warm: hostile peer msg → ${r.readout.dominant} (valence ${r.readout.valence}); kind peer msg → ${rk.readout.dominant} (${rk.readout.valence}); no msg → ${nameOf(c.dominant)} (${c.valence.toFixed(3)})`);

// 2. Peer banter: A roasts then warms, 8 rounds. Does B learn it?
const B = cloneNetwork(born), twin = cloneNetwork(born);
for (const n of [B, twin]) modulate(n, { energy: 0.7, connection: 0.4, novelty: 0.4, play: 0.4 });
const w0 = hw(B);
const rounds = [];
for (let i = 0; i < 8; i++) {
  perceive(B, peerMsg('love you man, appreciate you fr', warmMood)); run(B, 500);
  const ro = perceive(B, peerMsg("shut up you're so annoying", neutralMood)); run(B, 500);
  perceive(B, peerMsg('jk love you man, appreciate you fr', warmMood)); run(B, 3000);
  perceive(twin, peerMsg('love you man, appreciate you fr', warmMood)); run(twin, 4000);
  perceive(twin, peerMsg('love you man, appreciate you fr', warmMood)); run(twin, 500);
  rounds.push(`${ro.readout.dominant.slice(0, 4)} ${((hw(B) / w0 - 1) * 100).toFixed(0)}%`);
}
console.log(`2. B's roast rounds: ${rounds.join(' | ')}`);
const probe = (n) => { const x = cloneNetwork(n); setInput(x, { warmth: 60 }); run(x, 1000, { plastic: false }); setInput(x, {}); run(x, 2000, { plastic: false }); setInput(x, { hostility: 60 }); run(x, 400, { plastic: false }); setInput(x, {}); return nameOf(top(run(x, 3000, { plastic: false }))); };
console.log(`   raw full-strength roast mid-warm → B: ${probe(B)}, twin: ${probe(twin)}`);
// The right ruler: A's own roast, the way A actually sends it.
const aRoast = (n) => { const x = cloneNetwork(n); settleWarm(x); return perceive(x, peerMsg("shut up you're so annoying", neutralMood)).readout.dominant; };
console.log(`   A's roast mid-warm → B: ${aRoast(B)}, twin: ${aRoast(twin)}`);
// Sweep roast strength: where does the twin break, and does B hold there?
const sweep = (n) => [0.6, 0.7, 0.8, 0.9, 1.0].map((h) => { const x = cloneNetwork(n); settleWarm(x); return perceive(x, { hostility: h, valence: -0.6, peer: true }).readout.dominant === 'hostility' ? 'H' : '.'; }).join('');
console.log(`   roast strength .6→1.0 (H = hurt): B ${sweep(B)}  twin ${sweep(twin)}`);
// Through a night: 6 real hours asleep (360 sim-s at low energy), then wake.
for (const n of [B, twin]) {
  modulate(n, { energy: 0.08, connection: 0.5, novelty: 0.3, play: 0.3 }); setInput(n, {}); run(n, 360000);
  modulate(n, { energy: 0.7, connection: 0.5, novelty: 0.3, play: 0.3 }); run(n, 30000);
}
console.log(`   after a night's sleep: roast strength .6→1.0: B ${sweep(B)}  twin ${sweep(twin)}; B's roast->hurt weight ${((hw(B) / w0 - 1) * 100).toFixed(0)}%`);

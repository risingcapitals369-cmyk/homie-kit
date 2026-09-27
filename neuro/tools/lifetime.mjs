// How long does a feeling actually live? Hurt it at 9pm, then 72 real hours of
// silence with the real body clock (sleep ~2:30-8:30am) and rising loneliness.
// usage: node neuro/tools/lifetime.mjs <stickiness> [seed] [hours]
import { createNetwork, run, setInput, modulate, calibrateDecoder, decode, SMALL, CHANNELS } from '../snn.js';
import { circadianEnergy } from '../../src/affect.js';

const stickiness = Number(process.argv[2] || 1);
const seed = Number(process.argv[3] || 7);
const hours = Number(process.argv[4] || 72);
const net = createNetwork({ ...SMALL, seed, stickiness });
calibrateDecoder(net);
run(net, 2000, { plastic: false, homeostasis: false });
const name = (s) => { const k = s.clusterRates.indexOf(Math.max(...s.clusterRates)); return CHANNELS[net.chanClusters.findIndex((c) => c[0] === k)]; };

let clock = 21; // local hour
let energy = circadianEnergy(clock);
const chem = (silentH) => modulate(net, { energy, connection: Math.min(1, 0.3 + 0.022 * silentH), novelty: Math.min(1, 0.3 + 0.02 * silentH), play: Math.min(1, 0.4 + 0.02 * silentH) });

chem(0);
for (let i = 0; i < 8; i++) { setInput(net, { vulnerability: 60, contact: 30 }); run(net, 1000); setInput(net, {}); run(net, 5000); }
clock += 48 / 60;
console.log(`stickiness ${stickiness}, seed ${seed}: hurt from 9:00pm to 9:48pm`);

for (let h = 1; h <= hours; h++) {
  // 60 sim-seconds per real hour, energy relaxing toward the body clock each sim-minute-ish
  let s;
  for (let m = 0; m < 6; m++) {
    const hourNow = (clock + m / 6) % 24;
    energy += (circadianEnergy(hourNow) - energy) * (1 - Math.pow(0.5, (1 / 6) / 1.5));
    chem(h);
    s = run(net, 10000);
  }
  clock += 1;
  const r = decode(net, s);
  const hh = Math.floor(clock % 24);
  console.log(`+${String(h).padStart(2)}h ${String(hh).padStart(2)}:00 energy ${energy.toFixed(2)} | ${name(s).padEnd(13)} valence ${r.valence.toFixed(2)} E ${s.eRate.toFixed(1)}Hz peak ${Math.max(...s.clusterRates).toFixed(0)}Hz`);
}

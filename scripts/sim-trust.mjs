// How fast do trust and attachment grow over months of real talk? Uses the real
// feel()/advance() (float model). 4 texts a day around 7 PM, a mix like his.
// usage: node scripts/sim-trust.mjs [days=90] [kind=eventful|bland]
import { newMind, advance, feel, normalizeAppraisal } from '../src/affect.js';
const DAYS = Number(process.argv[2] || 90), kind = process.argv[3] || 'eventful';
const H = 3600e3, T0 = Date.UTC(2026, 8, 1);
const hourAt = (t) => (((t - T0) / H) % 24 + 24) % 24;
let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const MIX = kind === 'bland'
  ? [{ novelty: 0.1, boring: 0.7, honesty: 0, warmth: 0.1 }]
  : [{ honesty: 0.7, vulnerability: 0.4, warmth: 0.5 }, { humor: 0.7, hostility: 0.3, warmth: 0.3 }, { warmth: 0.8, honesty: 0.3 }, { win: 0.8, honesty: 0.4, warmth: 0.5 }, { novelty: 0.4, honesty: 0.3 }];
const m = newMind(T0);
const at = {};
for (let d = 0; d < DAYS; d++) {
  for (let k = 0; k < 4; k++) {
    const now = T0 + (d * 24 + 19) * H + k * 10 * 60e3;
    advance(m, now, hourAt);
    feel(m, normalizeAppraisal({ intensity: 0.5, ...MIX[Math.floor(rnd() * MIX.length)] }, ''), { now, silenceH: k ? 0.2 : 23 });
  }
  // Nightly reflection learns his roasts are banter (as in the 14-day probe: -0.03/night to the 0.6 floor).
  if (kind === 'eventful') m.sens.hostility = Math.max(0.6, m.sens.hostility - 0.03);
  if ([3, 7, 14, 30, 60, 90].includes(d + 1)) at[d + 1] = `trust ${m.affect.trust.toFixed(2)} attach ${m.affect.attachment.toFixed(2)}`;
}
console.log(kind, JSON.stringify(at, null, 0));

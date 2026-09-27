// Brain-to-brain at the brain level: the other friend's messages come in
// through the same 8 channels (flag: peer, no contact), with mood contagion.
// node --test test/peer.test.mjs   (~2-3 min: real simulations incl. a night)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, run, setInput, modulate, calibrateDecoder, cloneNetwork, decode, SMALL } from '../neuro/snn.js';
import { perceive } from '../neuro/brain.mjs';
import { withContagion, heuristicAppraisal } from '../src/affect.js';

let born;
const warmMood = { valence: 0.85, warmth: 0.8, playfulness: 0.7, irritation: 0.1, tension: 0.1 };
const saltyMood = { valence: 0.2, warmth: 0.2, playfulness: 0.3, irritation: 0.8, tension: 0.5 };
const neutralMood = { valence: 0.5, warmth: 0.3, playfulness: 0.3, irritation: 0.3, tension: 0.2 };
const peerMsg = (text, mood) => ({ ...withContagion(heuristicAppraisal(text), mood), peer: true });
const settleWarm = (n) => { setInput(n, { warmth: 60 }); run(n, 1000, { plastic: false }); setInput(n, {}); run(n, 2000, { plastic: false }); };
const awake = (n) => modulate(n, { energy: 0.7, connection: 0.4, novelty: 0.4, play: 0.4 });

before(() => {
  born = createNetwork({ ...SMALL, seed: 3 });
  calibrateDecoder(born);
  run(born, 2000, { plastic: false, homeostasis: false });
});

test("the other friend's message measurably moves this brain", () => {
  const control = cloneNetwork(born), hit = cloneNetwork(born);
  for (const n of [control, hit]) { awake(n); settleWarm(n); }
  run(control, 2000);
  const r = perceive(hit, peerMsg("shut up you're so annoying", saltyMood));
  const c = decode(control, run(control, 1000, { plastic: false }));
  assert.ok(c.valence - r.readout.valence > 0.5, `valence ${c.valence.toFixed(2)} (no message) vs ${r.readout.valence} (message)`);
});

test('it learns something specific from the other friend, and it survives a night of sleep', () => {
  const B = cloneNetwork(born), twin = cloneNetwork(born);
  for (const n of [B, twin]) awake(n);
  for (let i = 0; i < 8; i++) {
    perceive(B, peerMsg('love you man, appreciate you fr', warmMood)); run(B, 500);
    perceive(B, peerMsg("shut up you're so annoying", neutralMood)); run(B, 500);
    perceive(B, peerMsg('jk love you man, appreciate you fr', warmMood)); run(B, 3000);
    perceive(twin, peerMsg('love you man, appreciate you fr', warmMood)); run(twin, 4000);
    perceive(twin, peerMsg('love you man, appreciate you fr', warmMood)); run(twin, 500);
  }
  // How strong a roast from them does it take to hurt? (first strength that lands in hurt)
  const breaks = (n) => {
    for (const h of [0.6, 0.7, 0.8, 0.9, 1.0]) {
      const x = cloneNetwork(n); settleWarm(x);
      if (perceive(x, { hostility: h, valence: -0.6, peer: true }).readout.dominant === 'hostility') return h;
    }
    return 1.1;
  };
  const before = { B: breaks(B), twin: breaks(twin) };
  assert.ok(before.B > before.twin, `learned tolerance for their roasts: B breaks at ${before.B}, twin at ${before.twin}`);
  for (const n of [B, twin]) {
    modulate(n, { energy: 0.08, connection: 0.5, novelty: 0.3, play: 0.3 }); setInput(n, {}); run(n, 360000);   // ~6 real hours asleep
    modulate(n, { energy: 0.7, connection: 0.5, novelty: 0.3, play: 0.3 }); run(n, 30000);
  }
  const after = { B: breaks(B), twin: breaks(twin) };
  assert.ok(after.B > after.twin && after.B >= before.B, `still there after sleep: B breaks at ${after.B}, twin at ${after.twin}`);
});

test("no cross-contamination: one brain learning never touches the other's weights", () => {
  const A = cloneNetwork(born), B = cloneNetwork(born);
  awake(A); awake(B);
  const snapshot = { w: A.w.slice(), inW: A.inW.slice(), bias: A.bias.slice(), elig: A.elig.slice() };
  for (let i = 0; i < 4; i++) { perceive(B, peerMsg("shut up you're so annoying", neutralMood)); perceive(B, peerMsg('jk love you', warmMood)); }
  for (const k of Object.keys(snapshot)) assert.ok(snapshot[k].every((v, i) => v === A[k][i]), `A.${k} unchanged`);
  assert.ok(B.inW.some((v, i) => v !== born.inW[i]), 'while B did learn');
});

test('a peer message is never "contact with my person"', async () => {
  const { inputFor } = await import('../neuro/brain.mjs');
  assert.equal(inputFor({ peer: true, warmth: 1 }).contact, undefined);
  assert.equal(inputFor({ warmth: 1 }).contact, 30);
});

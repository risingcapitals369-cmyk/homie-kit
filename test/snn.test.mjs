// Substrate tests. Uses the half-size network (same in-degree, same dynamics).
// node --test test/snn.test.mjs   (~1 min: these are real simulations)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNetwork, run, setInput, modulate, calibrateDecoder, decode, cloneNetwork,
  serialize, deserialize, CHANNELS, SMALL,
} from '../neuro/snn.js';
import { newMind, decide, heuristicAppraisal } from '../src/affect.js';
import { perceive } from '../neuro/brain.mjs';

let born; // one calibrated newborn network; each test works on its own clone
const off = (net) => setInput(net, {});
const clusterOf = (net, ch) => net.chanClusters[CHANNELS.indexOf(ch)][0];
const dominant = (stats) => stats.clusterRates.indexOf(Math.max(...stats.clusterRates));

before(() => {
  born = createNetwork({ ...SMALL, seed: 7 });
  calibrateDecoder(born);
  run(born, 2000, { plastic: false, homeostasis: false });
});

// Repeated hurt: 8 x (1s input, 5s gap), like an hour of bad conversation.
function hurt(net, ch = 'vulnerability') {
  for (let i = 0; i < 8; i++) {
    setInput(net, { [ch]: 60 });
    run(net, 1000);
    off(net);
    run(net, 5000);
  }
}

test('healthy firing at rest: not dead, not seizing', () => {
  const net = cloneNetwork(born);
  const s = run(net, 3000, { plastic: false });
  assert.ok(s.eRate > 0.3 && s.eRate < 20, `E rate ${s.eRate.toFixed(2)} Hz`);
  assert.ok(s.iRate < 150, `I rate ${s.iRate.toFixed(1)} Hz`);
  assert.ok(Math.max(...s.clusterRates) < 150, 'no runaway cluster');
});

test('attractor: sustained negative input leaves a low state that persists with no further input', () => {
  const net = cloneNetwork(born);
  hurt(net);
  const target = clusterOf(net, 'vulnerability');
  // 60 sim-seconds (~1 real hour) of silence at real homeostasis rates.
  for (let sec = 0; sec < 60; sec++) {
    const s = run(net, 1000);
    if (sec >= 30) assert.equal(dominant(s), target, `left the low basin at ${sec}s`);
  }
  const mood = decode(net, run(net, 1000));
  assert.ok(mood.valence < 0.4, `valence readout should be low, got ${mood.valence.toFixed(2)}`);
});

test('basins deepen with time: a weak good message lifts a fresh bad mood but not an entrenched one', () => {
  const lift = (dwellMs, hz) => {
    const net = cloneNetwork(born);
    setInput(net, { hostility: 60 }); run(net, 1000);
    off(net); run(net, dwellMs);
    setInput(net, { warmth: hz }); run(net, 500);
    off(net);
    return dominant(run(net, 2000)) === clusterOf(net, 'warmth');
  };
  assert.equal(lift(1000, 20), true, 'fresh: a mild warm message should cheer it up');
  assert.equal(lift(60000, 20), false, 'after ~an hour stuck, the same mild warmth should not');
  assert.equal(lift(60000, 45), true, 'but a strong one still gets through');
});

test('homeostasis eventually lifts a stuck mood (time-accelerated 100x)', () => {
  const net = cloneNetwork(born);
  hurt(net);
  const stuck = decode(net, run(net, 1000));
  assert.ok(stuck.valence < 0.4, `should start stuck low, got ${stuck.valence.toFixed(2)}`);
  net.p = { ...net.p, etaHomeo: 2e-5, scaleHomeo: 0.01, tauRate: 5000 };  // speed up recovery only
  let lifted = null;
  for (let sec = 0; sec < 200 && lifted == null; sec++) {
    const s = run(net, 1000);
    if (dominant(s) !== clusterOf(net, 'vulnerability') && s.clusterRates[dominant(s)] > 5) lifted = decode(net, s);
  }
  assert.ok(lifted, 'should leave the low basin on its own');
  assert.ok(lifted.valence > stuck.valence, `lifted valence ${lifted?.valence.toFixed(2)} vs stuck ${stuck.valence.toFixed(2)}`);
});

test('STDP is per-association, and it survives synaptic scaling (not just a transient)', () => {
  // Same roast, two contexts, 5 times each. Measured 20 s later (40 scaling
  // events), as mean % change per synapse. Association = context->roast minus
  // the other context's link, so global drift cancels out.
  const roastIn = (ctx) => {
    const net = cloneNetwork(born);
    const w0 = net.w.slice();
    modulate(net, { novelty: 0.5, play: 0.5 });
    for (let i = 0; i < 5; i++) {
      setInput(net, { [ctx]: 60 }); run(net, 1000);
      off(net); run(net, 3000);
      setInput(net, { hostility: 60 }); run(net, 400);
      setInput(net, { [ctx]: 60 }); run(net, 600);
      off(net); run(net, 5000);
    }
    off(net); run(net, 20000);
    const H = clusterOf(net, 'hostility');
    return (fromCh) => {
      const F = clusterOf(net, fromCh);
      let s = 0, c = 0;
      for (let k = 0; k < net.w.length; k++) {
        const pre = net.synPre[k], post = net.synPost[k];
        if (pre < net.nE && post < net.nE && net.cluster[pre] === F && net.cluster[post] === H) { s += (net.w[k] - w0[k]) / w0[k]; c++; }
      }
      return (100 * s) / c;
    };
  };
  const warm = roastIn('warmth'), joking = roastIn('humor');
  const warmAssoc = warm('warmth') - warm('humor');
  const jokeAssoc = joking('humor') - joking('warmth');
  assert.ok(warmAssoc > 1, `roasted while warm: warm->roast should beat humor->roast, got ${warmAssoc.toFixed(1)}%`);
  assert.ok(jokeAssoc > 1, `roasted while joking: humor->roast should beat warm->roast, got ${jokeAssoc.toFixed(1)}%`);
});

test('three-factor learning: it learns your roasts are banter, stops when it knows, and real hostility still gets through', () => {
  const WARM = { warmth: 1, valence: 0.8 }, ROAST = { hostility: 1, valence: -0.6 };
  const H = clusterOf(born, 'hostility'), W = clusterOf(born, 'warmth');
  const top = (s) => dominant(s);
  const learned = cloneNetwork(born), twin = cloneNetwork(born);
  let lastD = null;
  for (let i = 0; i < 8; i++) {
    for (const [n, roast] of [[learned, true], [twin, false]]) {
      perceive(n, WARM); off(n); run(n, 3000);
      if (roast) perceive(n, ROAST);
      const r = perceive(n, WARM);
      if (roast) lastD = r.readout.dopamine;
      off(n); run(n, 5000);
    }
  }
  assert.ok(Math.abs(lastD) < 0.1, `learning should stop once roasts stop hurting (last surprise ${lastD})`);

  // Banter: a strong roast mid-warm-mood. The brain that knows you stays warm; the twin is hurt.
  const roastMidWarm = (n) => {
    const c = cloneNetwork(n);
    setInput(c, { warmth: 60 }); run(c, 1000, { plastic: false });
    off(c); run(c, 2000, { plastic: false });
    setInput(c, { hostility: 60 }); run(c, 400, { plastic: false });
    off(c); return top(run(c, 3000, { plastic: false }));
  };
  assert.equal(roastMidWarm(learned), W, 'knows you: a roast is banter');
  assert.equal(roastMidWarm(twin), H, 'twin: the same roast hurts');

  // Real hostility (no "jk"), live brain: tolerance, not numbness.
  const hostileUntilHurt = (n) => {
    const c = cloneNetwork(n);
    perceive(c, WARM); off(c); run(c, 3000);
    for (let k = 1; k <= 10; k++) {
      const r = perceive(c, { hostility: 1, valence: -0.7 });
      off(c); run(c, 2000);
      if (r.readout.valence < 0.4) return k;
    }
    return Infinity;
  };
  const k = hostileUntilHurt(learned);
  assert.ok(k <= 6, `sustained real hostility must still get through (took ${k})`);
  assert.equal(hostileUntilHurt(twin), 1);
});

test('neuromodulation: low energy lowers gain, loneliness is an inverted U, no plasticity = no learning', () => {
  const respond = (mods) => {
    const net = cloneNetwork(born);
    modulate(net, mods);
    setInput(net, { warmth: 40 });
    return run(net, 1000, { plastic: false, homeostasis: false }).eRate;
  };
  const normal = respond({ energy: 0.65, connection: 0.5 });
  const tired = respond({ energy: 0.1, connection: 0.5 });
  const missesYou = respond({ energy: 0.65, connection: 0.7 });
  const isolated = respond({ energy: 0.65, connection: 1 });
  assert.ok(tired < normal, `tired ${tired.toFixed(1)} < normal ${normal.toFixed(1)}`);
  assert.ok(missesYou > normal, `acute loneliness is vigilant: ${missesYou.toFixed(1)} > ${normal.toFixed(1)}`);
  assert.ok(isolated < missesYou, `sustained isolation withdraws instead of running hot: ${isolated.toFixed(1)} < ${missesYou.toFixed(1)}`);

  const net = cloneNetwork(born);
  modulate(net, { learning: 0 });
  const w0 = net.w.slice();
  setInput(net, { hostility: 60 }); run(net, 500);
  assert.ok(net.w.every((v, i) => v === w0[i] || Math.abs(v - w0[i]) < 1e-3), 'plasticity gated off');
});

test('decoder reads the basin, not the input: valence low in a hurt state, high in a warm one', () => {
  const settle = (ch) => {
    const net = cloneNetwork(born);
    setInput(net, { [ch]: 60 }); run(net, 1000, { plastic: false });
    off(net); run(net, 2000, { plastic: false });
    return decode(net, run(net, 1000, { plastic: false }));   // no input at all while reading
  };
  const bad = settle('hostility'), good = settle('warmth');
  assert.ok(bad.valence < 0.4 && good.valence > 0.6, `hostile ${bad.valence.toFixed(2)}, warm ${good.valence.toFixed(2)}`);
  assert.ok(bad.irritation > good.irritation);
});

test('serialization round-trips exactly (same future)', () => {
  const a = cloneNetwork(born);
  const b = deserialize(serialize(a));
  setInput(a, { humor: 30 }); setInput(b, { humor: 30 });
  assert.deepEqual(run(a, 500).clusterRates, run(b, 500).clusterRates);
});

test('crisis override fires even from a network stuck in a low basin', () => {
  const net = cloneNetwork(born);
  hurt(net);
  const mood = decode(net, run(net, 2000));
  const m = newMind(Date.now());
  Object.assign(m.affect, { valence: mood.valence, tension: mood.tension, irritation: mood.irritation, playfulness: mood.playfulness, energy: 0.1 });
  const ap = heuristicAppraisal("i don't want to be here anymore");
  const plan = decide(m, ap, { pendingCount: 0 });
  assert.equal(plan.respond, 'now');
  assert.equal(plan.mode, 'real');
  assert.match(plan.notes.join(' '), /988/);
});

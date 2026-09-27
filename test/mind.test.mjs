// The integration layer (src/mind.js): workspace, conflict, metacognition, self delta, reconsolidation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMind } from '../src/affect.js';
import { fuse, workspace, conflicts, metacog, moodOrigin, selfDelta, snapshot, reconsolidate, floatShares } from '../src/mind.js';

const mix = (o) => { const s = { warmth: 0, hostility: 0, vulnerability: 0, win: 0, humor: 0, novelty: 0, boring: 0, contact: 0, ...o }; const t = Object.values(s).reduce((a, b) => a + b, 0); for (const k in s) s[k] /= t; return s; };

test('fuse: one basin is coherent, a warm+stung mix is torn, and the same top cluster with different blends reads differently', () => {
  const clear = fuse(mix({ warmth: 0.9, contact: 0.1 }));
  const torn = fuse(mix({ warmth: 0.45, hostility: 0.4, contact: 0.15 }));
  assert.ok(clear.coherence > 0.5 && clear.torn === 0, JSON.stringify(clear));
  assert.ok(torn.torn >= 0.5 && torn.coherence < clear.coherence, JSON.stringify(torn));
  const a = workspace({ shares: mix({ warmth: 0.5, humor: 0.35, novelty: 0.15 }), affect: { arousal: 0.4 }, drives: {}, mem: [] });
  const b = workspace({ shares: mix({ warmth: 0.5, vulnerability: 0.35, contact: 0.15 }), affect: { arousal: 0.4 }, drives: {}, mem: [] });
  assert.equal(a.fused.top[0].k, b.fused.top[0].k);          // same dominant channel
  assert.notEqual(a.text, b.text);                            // different moment
  assert.ok(a.fused.net > b.fused.net);                       // humor blend sits better than a worry blend
});

test('fuse: drift is measured against the earlier moment', () => {
  const f = fuse(mix({ humor: 0.6, warmth: 0.4 }), undefined, { shares: mix({ humor: 0.2, warmth: 0.8 }) });
  assert.equal(f.drift.toward, 'humor');
});

test('spotlight: a dry text loses to a strong memory; a heavy text wins; a crisis always wins', () => {
  const shares = mix({ warmth: 0.3, humor: 0.3, novelty: 0.2, contact: 0.2 });
  const mem = [{ id: 1, gist: 'his son had spots, the ER waved it off', score: 0.8, open: 1 }];
  const dry = workspace({ shares, ap: { intensity: 0.1, importance: 0, question: 0, vulnerability: 0 }, affect: { arousal: 0.3 }, drives: {}, mem });
  assert.equal(dry.spot.winner.kind, 'memory');
  const heavy = workspace({ shares, ap: { intensity: 0.9, importance: 0.9, question: 0.6, vulnerability: 0.7 }, affect: { arousal: 0.3 }, drives: {}, mem });
  assert.equal(heavy.spot.winner.kind, 'message');
  const crisis = workspace({ shares: mix({ hostility: 1 }), ap: { crisis: true }, affect: { arousal: 1 }, drives: { connection: 1 }, mem });
  assert.equal(crisis.spot.winner.kind, 'message');
});

test('conflict: calm resting state has none; playful + he opens up is a close fight with a computed winner', () => {
  const m = newMind(0);
  assert.equal(conflicts({ affect: m.affect, drives: m.drives, ap: {} })[0].strength, 0);
  m.affect.playfulness = 0.85; m.drives.play = 0.8; m.affect.tension = 0.45;
  const cs = conflicts({ affect: m.affect, drives: m.drives, ap: { vulnerability: 0.75, humor: 0.1 } });
  const c = cs.find((x) => x.axis === 'joke_vs_straight');
  assert.ok(c.strength > 0.3, JSON.stringify(c));
  assert.equal(c.winner, c.sides[0].pull >= c.sides[1].pull ? 'joke around' : 'answer straight');
  assert.ok(c.sides.every((s) => s.because.length > 0));
});

test('conflict: the substrate itself can be torn (good vs bad at once)', () => {
  const m = newMind(0);
  const c = conflicts({ affect: m.affect, drives: m.drives, shares: mix({ warmth: 0.5, hostility: 0.45, contact: 0.05 }) }).find((x) => x.axis === 'good_vs_bad');
  assert.ok(c.strength > 0.3, JSON.stringify(c));
});

test('metacog: low mood + a real question = override; low + exhausted = can\'t fully; low + "lol" = mood leads quietly', () => {
  const m = newMind(0);
  Object.assign(m.affect, { valence: 0.25, irritation: 0.55, energy: 0.6, dominance: 0.6 });
  assert.equal(metacog({ affect: m.affect, baseline: m.baseline, ap: { question: 0.8 } }).decision, 'override');
  Object.assign(m.affect, { energy: 0.22, dominance: 0.3, tension: 0.6 });
  assert.equal(metacog({ affect: m.affect, baseline: m.baseline, ap: { question: 0.8 } }).decision, "can't fully override");
  assert.equal(metacog({ affect: m.affect, baseline: m.baseline, ap: { boring: 0.9 } }).decision, 'noticed, letting it be');
  const fine = newMind(0);
  assert.equal(metacog({ affect: fine.affect, baseline: fine.baseline, ap: { question: 0.9 } }).decision, 'mood leads');
});

test('metacog: the mood is traced to an earlier event, and knows whether it is about this', () => {
  const m = newMind(0);
  m.affect.valence = 0.25;
  const eps = [{ gist: 'he blew me off', ts: 1000, valence: 0.2, tags: '["plans"]' }];
  const unrelated = moodOrigin({ affect: m.affect, baseline: m.baseline, episodes: eps, topics: ['work'], now: 3 * 3600e3 });
  const related = moodOrigin({ affect: m.affect, baseline: m.baseline, episodes: eps, topics: ['plans'], now: 3 * 3600e3 });
  assert.equal(unrelated.aboutThis, false);
  assert.equal(related.aboutThis, true);
  // Sad about his bad news while he asks about that same news: fitting, not something to override.
  assert.equal(metacog({ affect: m.affect, baseline: m.baseline, ap: { question: 0.9 }, origin: related }).decision, 'mood fits the moment');
  assert.equal(metacog({ affect: m.affect, baseline: m.baseline, ap: { question: 0.9 }, origin: unrelated }).decision, 'override');
});

test('selfDelta: reports only what changed, from the numbers', () => {
  const m = newMind(0);
  m.day = { n: 10, valence: 6, basins: { humor: 2, warmth: 8 } };
  const then = snapshot(m, { learned: { sensory: { hostility: 1 }, selfHold: { hostility: 1 } } });
  assert.deepEqual(selfDelta(then, then), []);
  m.sens = { ...m.sens, hostility: 0.85 }; m.affect.trust = 0.55; m.day = { n: 10, valence: 6, basins: { humor: 6, warmth: 4 } };
  const now = snapshot(m, { learned: { sensory: { hostility: 0.9 }, selfHold: { hostility: 1 } } });
  const d = selfDelta(now, then).map((x) => x.what);
  assert.ok(d.includes('sens.hostility') && d.includes('trust') && d.includes('time.humor') && d.includes('wiring.hostility'), d.join(','));
  assert.ok(!d.includes('hold.hostility'));
});

test('reconsolidate: recall drags the feeling toward now, bounded around the original', () => {
  let ep = { valence: 0.2 };
  for (let i = 0; i < 50; i++) ep = { ...ep, ...reconsolidate(ep, 0.9) };
  assert.equal(ep.v0, 0.2);
  assert.ok(ep.valence <= 0.5 + 1e-9 && ep.valence > 0.45, String(ep.valence));
});

test('floatShares is a proper mixture', () => {
  const m = newMind(0);
  const s = floatShares(m.affect, m.drives);
  assert.ok(Math.abs(Object.values(s).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

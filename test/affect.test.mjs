// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newMind, advance, feel, decide, describe, moodTag, heuristicAppraisal, normalizeAppraisal,
  recall, salienceNow, urge, nudgeBaseline, nudgeSensitivity, feltWord, decideSeek, afterSeek, decidePeer, acceptPeer, withContagion, textFirstChance, PERSONALITY, ASLEEP_BELOW, AWAKE_ABOVE,
} from '../src/affect.js';

const H = 3600e3;
// Fake clock: "day 0" starts at local midnight; local hour = hours since start mod 24.
const T0 = Date.UTC(2026, 8, 1);
const hourAt = (t) => (((t - T0) / H) % 24 + 24) % 24;
const at = (day, hour) => T0 + (day * 24 + hour) * H;
const fixed = (x) => () => x;

function talk(m, text, now) {
  const ap = heuristicAppraisal(text);
  const silenceH = m.lastContact ? (now - m.lastContact) / H : 999;
  advance(m, now, hourAt);
  feel(m, ap, { now, silenceH });
  return ap;
}

test('same question on two different days gets a genuinely different reply plan', () => {
  const q = 'what do you think i should do this weekend?';

  // Day A: mid-afternoon after a fun, warm, active conversation.
  const a = newMind(at(0, 12));
  for (const [h, msg] of [[13, 'lmao bro i just got the job!!'], [13.2, 'love you man, you called it'], [13.4, 'haha thats dead 💀']]) talk(a, msg, at(0, h));
  const apA = talk(a, q, at(0, 14));
  const planA = decide(a, apA, { theirWords: 9, rng: fixed(0.5) });

  // Day B: he vanished for 3 days, came back cold and hostile late at night.
  const b = newMind(at(0, 12));
  talk(b, 'yo', at(0, 13));
  talk(b, 'shut up youre annoying', at(3, 23));
  talk(b, 'k', at(3, 23.2));
  const apB = talk(b, q, at(3, 23.5));
  const planB = decide(b, apB, { theirWords: 9, rng: fixed(0.5) });

  assert.notEqual(describe(a), describe(b));
  assert.notDeepEqual(planA.notes, planB.notes);
  assert.ok(a.affect.valence > b.affect.valence, 'day A should feel better');
  assert.ok(b.affect.irritation > a.affect.irritation, 'day B should be saltier');
  assert.notEqual(moodTag(a).word, moodTag(b).word);
});

test('goes quiet when energy is low instead of forcing a reply', () => {
  const m = newMind(at(0, 12));
  talk(m, 'hey', at(0, 12));
  const ap = talk(m, 'you up? random thought', at(1, 3.5));
  assert.ok(m.affect.energy < ASLEEP_BELOW, `energy at 3:30am should be asleep, got ${m.affect.energy.toFixed(2)}`);
  assert.equal(decide(m, ap, { pendingCount: 0 }).respond, 'later');
  // ...but if he keeps texting, it wakes up groggy, and it's not a punishment.
  const t = at(1, 3.5);
  const woke = decide(m, ap, { pendingCount: 2, now: t });
  assert.equal(woke.respond, 'now');
  assert.equal(woke.length, 'one-liner');
  assert.match(woke.notes.join(' '), /do not mind/);
  assert.doesNotMatch(woke.notes.join(' '), /blew up/);
  // Once up, it stays up for a bit instead of dozing off between his texts.
  assert.equal(decide(m, ap, { pendingCount: 0, now: t + 5 * 60e3 }).respond, 'now');
  assert.equal(decide(m, ap, { pendingCount: 0, now: t + 40 * 60e3 }).respond, 'later');
  // By morning it is awake again.
  advance(m, at(1, 11), hourAt);
  assert.ok(m.affect.energy > AWAKE_ABOVE, `should be awake by 11am, got ${m.affect.energy.toFixed(2)}`);
});

test('a crisis always gets an immediate sincere reply, even asleep and salty', () => {
  const m = newMind(at(0, 12));
  talk(m, 'fuck you youre useless', at(0, 12));
  const ap = talk(m, 'honestly i just want to die', at(1, 4));
  assert.equal(ap.crisis, true);
  const plan = decide(m, ap, { pendingCount: 0 });
  assert.equal(plan.respond, 'now');
  assert.equal(plan.mode, 'real');
  assert.match(plan.notes.join(' '), /988/);
  assert.equal(feltWord(m.affect.valence, m.affect.arousal), 'rattled', 'a scary moment is never remembered as a good one');
  assert.doesNotMatch(describe(m), /mess around/);
  // Curly apostrophes (iPhone keyboard, voice transcripts) must trip it too.
  assert.equal(normalizeAppraisal({ crisis: false }, 'I don’t want to be here anymore').crisis, true, 'curly apostrophe');
  assert.equal(normalizeAppraisal({ crisis: false }, 'honestly man, I don’t want to live').crisis, true);
  // LLM said no crisis? The regex still catches it.
  assert.equal(normalizeAppraisal({ crisis: false }, 'i might kill myself').crisis, true);
});

test('an old emotional thread stays salient and comes back over a recent trivial one', () => {
  const m = newMind(at(0, 12));
  const now = at(9, 15);
  const eps = [
    { id: 1, gist: 'he was scared about his daughter being sick', tags: '["daughter","sick","hospital"]', ts: at(0, 20), touched_ts: at(0, 20), valence: 0.3, arousal: 0.7, salience: 0.95, recalls: 0, open: 1 },
    { id: 2, gist: 'he ate a burrito', tags: '["burrito","lunch"]', ts: at(9, 12), touched_ts: at(9, 12), valence: 0.55, arousal: 0.4, salience: 0.15, recalls: 0, open: 0 },
  ];
  const top = recall(eps, m, ['work'], now);
  assert.equal(top[0].id, 1, 'nine days later the heavy moment still outranks lunch');
  // Rehearsal: a recalled memory fades slower.
  const once = { ...eps[0], recalls: 2 };
  assert.ok(salienceNow(once, at(30, 0)) > salienceNow(eps[0], at(30, 0)));
});

test('attachment rises with contact and connection drive builds in silence', () => {
  const m = newMind(at(0, 12));
  const start = m.affect.attachment;
  for (let i = 0; i < 20; i++) talk(m, 'appreciate you bro, thanks', at(0, 12 + i * 0.1));
  assert.ok(m.affect.attachment > start);
  const afterTalk = urge(m);
  advance(m, at(3, 15), hourAt);
  assert.ok(m.drives.connection > 0.6, 'three days of silence should make it miss him');
  assert.ok(urge(m) > afterTalk, 'and want to text first');
});

test('bad news about his life makes it worried, not curious', () => {
  const m = newMind(at(0, 12));
  talk(m, "honestly i'm stressed, my daughter has been sick all week and i'm scared", at(0, 14));
  assert.equal(moodTag(m).word, 'worried');
  assert.equal(decide(m, heuristicAppraisal('scared about my daughter, stressed'), {}).mode, 'real');
});

test('state decays back toward baseline', () => {
  const m = newMind(at(0, 12));
  talk(m, 'fuck you youre useless, shut up', at(0, 12));
  const hot = m.affect.irritation;
  advance(m, at(0, 20), hourAt);
  assert.ok(m.affect.irritation < hot);
  assert.ok(Math.abs(m.affect.irritation - PERSONALITY.irritation) < 0.08);
});

test('reflection changes how hard things hit, but never the safety path', () => {
  const roast = 'shut up youre annoying lol';
  const before = newMind(at(0, 12));
  talk(before, roast, at(0, 13));
  const after = newMind(at(0, 12));
  for (let night = 0; night < 10; night++) nudgeSensitivity(after, { hostility: -0.05, bogus: 1 });
  assert.ok(after.sens.hostility >= 0.6 && after.sens.hostility < 1);
  assert.equal(after.sens.bogus, undefined);
  talk(after, roast, at(0, 13));
  assert.ok(after.affect.irritation < before.affect.irritation, 'learned his roasts are love: stings less');

  // Even fully desensitized to vulnerability, a hurting message still gets the real reply.
  const numb = newMind(at(0, 12));
  for (let n = 0; n < 20; n++) nudgeSensitivity(numb, { vulnerability: -0.05 });
  const ap = talk(numb, 'i feel so alone and depressed, scared', at(0, 14));
  assert.equal(decide(numb, ap, {}).mode, 'real');
});

test('curiosity acts from state, never on a schedule, and respects every guardrail', () => {
  const now = at(2, 15);
  const base = { now, hour: 15, idleMs: 2 * H, openWonders: 3, rng: () => 0 };
  const curious = () => { const m = newMind(now); m.affect.curiosity = 0.9; m.drives.novelty = 0.9; m.affect.energy = 0.7; return m; };

  assert.equal(decideSeek(curious(), base).seek, true, 'curious + idle + something unresolved → reaches');
  assert.equal(decideSeek(curious(), { ...base, searchEnabled: false }).mode, 'ponder', 'web off → ponders instead');

  const flat = curious(); flat.affect.curiosity = 0.3; flat.drives.novelty = 0.2;
  assert.equal(decideSeek(flat, base).seek, false, 'flat mood → no seeking');
  assert.equal(decideSeek(curious(), { ...base, hour: 23.5 }).seek, false, 'quiet hours');
  const asleep = curious(); asleep.affect.energy = 0.1;
  assert.equal(decideSeek(asleep, base).seek, false, 'asleep');
  const crisis = curious(); crisis.lastCrisis = now - 3 * H;
  assert.match(decideSeek(crisis, base).reason, /crisis/);
  assert.equal(decideSeek(curious(), { ...base, openWonders: 0 }).seek, false, 'nothing to wonder about');
  assert.equal(decideSeek(curious(), { ...base, idleMs: 10 * 60e3 }).seek, false, 'mid-conversation');

  // Daily cap and spacing.
  const m = curious();
  afterSeek(m, now);
  assert.equal(decideSeek(m, { ...base, now: now + 1 * H }).seek, false, 'min gap between searches');
  m.affect.curiosity = 0.9; m.drives.novelty = 0.9;
  afterSeek(m, now + 4 * H);
  m.affect.curiosity = 0.9; m.drives.novelty = 0.9;
  assert.match(decideSeek(m, { ...base, now: now + 8 * H, hour: 23 - 0.5 }).reason, /daily limit/);

  // State-driven, not timed: over a day of 5-min ticks, how often does it fire?
  let fires = 0;
  for (let i = 0; i < 288; i++) if (decideSeek(curious(), { ...base, rng: Math.random }).seek) fires++;
  let flatFires = 0;
  for (let i = 0; i < 288; i++) if (decideSeek(flat, { ...base, rng: Math.random }).seek) flatFires++;
  assert.ok(fires > 0 && flatFires === 0, `curious ticks fire (${fires}/288), flat never (${flatFires})`);
});

test('brain-to-brain: off by default, both sides must opt in, drive-based, crisis and budget shut it', () => {
  const now = at(2, 15);
  const ctx = { now, hour: 15, enabled: true, theirEnabled: true, brainOnline: true, idleMs: 2 * H, rng: () => 0 };
  const social = () => { const m = newMind(now); m.drives.connection = 0.9; m.affect.curiosity = 0.8; m.drives.play = 0.8; m.affect.energy = 0.7; return m; };

  assert.equal(decidePeer(social(), ctx).go, true, 'lonely + curious + both on → reaches out');
  assert.match(decidePeer(social(), { ...ctx, enabled: false }).reason, /off/);
  assert.match(decidePeer(social(), { ...ctx, theirEnabled: false }).reason, /other side/);
  assert.equal(decidePeer(social(), { ...ctx, brainOnline: false }).go, false);
  const crisis = social(); crisis.lastCrisis = now - H;
  assert.match(decidePeer(crisis, ctx).reason, /crisis/);
  assert.match(acceptPeer(crisis, ctx).reason, /crisis/, 'crisis also blocks incoming');
  assert.equal(decidePeer(social(), { ...ctx, idleMs: 5 * 60e3 }).go, false, 'not while talking to its own person');
  assert.equal(decidePeer(social(), { ...ctx, sentToday: 2 }).go, false, 'send cap');
  assert.equal(acceptPeer(social(), { ...ctx, receivedToday: 3 }).ok, false, 'receive cap');
  assert.match(decidePeer(social(), { ...ctx, callsToday: 30 }).reason, /budget/);
  assert.equal(decidePeer(social(), { ...ctx, hour: 2 }).go, false, 'quiet hours');
  const flat = social(); flat.drives.connection = 0.1; flat.affect.curiosity = 0.2; flat.drives.play = 0.1;
  let fires = 0; for (let i = 0; i < 288; i++) if (decidePeer(flat, { ...ctx, rng: Math.random }).go) fires++;
  assert.equal(fires, 0, 'no pull → never reaches out (no schedule)');

  // The other brain's mood rides into the same channels.
  const ap = withContagion({ warmth: 0, humor: 0, hostility: 0, vulnerability: 0, valence: 0 }, { warmth: 1, playfulness: 1, irritation: 0, tension: 0, valence: 1 });
  assert.ok(ap.warmth > 0.25 && ap.humor > 0.25 && ap.valence > 0.25);
});

test('texting first: quiet right after talking, then usually within ~5-10 awake hours (300 simulated silences)', () => {
  // A conversation ends at noon. Then silence. Heartbeat every 5 min, real gates:
  // awake only, 45 min idle, and the drive-based roll.
  const firsts = [];
  for (let run = 0; run < 300; run++) {
    const m = newMind(at(0, 11));
    for (let i = 0; i < 12; i++) talk(m, 'yo what up, love you man lol', at(0, 11 + i / 12));
    let sent = null;
    for (let tick = 1; tick <= 36 * 12 && sent == null; tick++) {
      const t = at(0, 12) + tick * 5 * 60e3;
      advance(m, t, hourAt);
      if (m.affect.energy < AWAKE_ABOVE) continue;
      if (Math.random() < textFirstChance(m).chance) sent = tick / 12;
    }
    firsts.push(sent ?? Infinity);
  }
  firsts.sort((a, b) => a - b);
  const q = (p) => firsts[Math.floor(p * firsts.length)];
  const within = (h) => firsts.filter((x) => x <= h).length / firsts.length;
  assert.ok(within(2) < 0.05, `almost never in the first 2 h (${(within(2) * 100).toFixed(0)}%)`);
  assert.ok(q(0.5) >= 4 && q(0.5) <= 11, `median first text ${q(0.5).toFixed(1)} h after going quiet`);
  assert.ok(within(24) > 0.9, `almost always within a day (${(within(24) * 100).toFixed(0)}%)`);
  console.log(`      first text after silence: 10% by ${q(0.1).toFixed(1)}h, median ${q(0.5).toFixed(1)}h, 90% by ${q(0.9).toFixed(1)}h`);
});

test('reflection can drift the baseline, but only a little and within limits', () => {
  const m = newMind(at(0, 12));
  for (let i = 0; i < 100; i++) nudgeBaseline(m, { warmth: 0.5, bogus: 1 });
  assert.ok(m.baseline.warmth <= PERSONALITY.warmth + 0.25 + 1e-9);
  assert.equal(m.baseline.bogus, undefined);
});

test('relationship grows with diminishing returns: no 0.99 in a month, real talk beats small talk', () => {
  const live = (mix) => {
    const m = newMind(T0);
    let i = 0;
    for (let d = 0; d < 30; d++) {
      for (let k = 0; k < 4; k++) {
        const now = at(d, 19) + k * 10 * 60e3;
        advance(m, now, hourAt);
        feel(m, normalizeAppraisal({ intensity: 0.5, ...mix[i++ % mix.length] }, ''), { now, silenceH: k ? 0.2 : 23 });
      }
      m.sens.hostility = Math.max(0.6, m.sens.hostility - 0.03);   // reflection learning the banter
    }
    return m.affect;
  };
  const real = live([{ honesty: 0.7, vulnerability: 0.4, warmth: 0.5 }, { humor: 0.7, hostility: 0.3, warmth: 0.3 }, { warmth: 0.8, honesty: 0.3 }, { win: 0.8, honesty: 0.4, warmth: 0.5 }]);
  const bland = live([{ novelty: 0.1, boring: 0.7, warmth: 0.1 }]);
  assert.ok(real.trust < 0.85 && real.attachment < 0.85, `real: ${real.trust} ${real.attachment}`);
  assert.ok(real.trust > bland.trust + 0.1, `trust real ${real.trust} vs bland ${bland.trust}`);
  assert.ok(real.attachment > bland.attachment, `attachment real ${real.attachment} vs bland ${bland.attachment}`);
});

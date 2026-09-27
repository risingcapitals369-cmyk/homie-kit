// ───────────────────────────────────────────────────────────────
//  THE AFFECTIVE CORE
//  A small dynamical system under the LLM. Affect and drives persist,
//  decay toward a (slowly drifting) personality baseline, follow a body
//  clock, and get pushed around by how each message lands. A policy then
//  turns that state into concrete instructions for the next reply.
//  Pure functions only: the worker loads/saves the state around them.
// ───────────────────────────────────────────────────────────────

export const AFFECT = ['valence', 'arousal', 'dominance', 'attachment', 'curiosity', 'boredom',
  'energy', 'tension', 'playfulness', 'warmth', 'trust', 'irritation'];
export const DRIVES = ['connection', 'novelty', 'rest', 'mastery', 'honesty', 'play'];

// Resting personality. All 0..1; valence 0.5 is neutral.
export const PERSONALITY = {
  valence: 0.58, arousal: 0.45, dominance: 0.58, attachment: 0.3, curiosity: 0.6, boredom: 0.25,
  energy: 0.65, tension: 0.2, playfulness: 0.72, warmth: 0.5, trust: 0.4, irritation: 0.12,
};
const DRIFT_LIMIT = 0.25; // nightly reflection can move the baseline this far from PERSONALITY, total

// Sensitivity multipliers on incoming appraisals (1 = as rated).
// e.g. after weeks of trust, his roasts might hit softer (hostility < 1).
export const SENS_DEFAULT = { hostility: 1, warmth: 1, vulnerability: 1, humor: 1, novelty: 1, win: 1 };
const SENS_MIN = 0.6, SENS_MAX = 1.5, SENS_STEP = 0.05;

// How fast each dimension relaxes back to its target, in hours (half-life).
// Attachment and trust are slow: they're relationship, not mood.
const HALF_LIFE_H = {
  valence: 8, arousal: 1.5, dominance: 12, attachment: 24 * 21, curiosity: 4, boredom: 3,
  energy: 1.5, tension: 4, playfulness: 5, warmth: 16, trust: 24 * 45, irritation: 3,
};

// Drives climb per hour while unmet. `rest` is derived from energy.
const DRIVE_RISE = { connection: 0.035, novelty: 0.02, mastery: 0.006, honesty: 0.004, play: 0.02 };

export const ASLEEP_BELOW = 0.2;   // energy under this = asleep, texts wait until morning
export const AWAKE_ABOVE = 0.3;

const clamp = (x, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo);
const num = (x, lo = 0, hi = 1) => clamp(Number(x) || 0, lo, hi);

export function newMind(now) {
  return {
    v: 1,
    ts: now,
    affect: { ...PERSONALITY },
    baseline: { ...PERSONALITY },
    drives: { connection: 0.4, novelty: 0.3, rest: 0.35, mastery: 0.3, honesty: 0.3, play: 0.4 },
    // How hard each kind of thing hits. Reflection retunes these over time.
    sens: { ...SENS_DEFAULT },
    name: null,
    lastContact: null,
    ignoredStreak: 0,
    lastUnprompted: 0,
    unpromptedDay: '',
    unpromptedCount: 0,
    reflectedDay: '',
  };
}

// Energy target by local hour (fractional). Fades after midnight, asleep ~2:30am-8:30am.
export function circadianEnergy(h) {
  if (h < 1) return 0.36;
  if (h < 8) return 0.06;
  if (h < 10) return 0.06 + ((h - 8) / 2) * 0.64;
  if (h < 18) return 0.72;
  if (h < 22) return 0.66;
  return 0.48;
}

// Run the clock forward from mind.ts to `now` in <=1h steps so the body clock is honored.
// hourAt(epoch) -> local fractional hour.
export function advance(mind, now, hourAt) {
  let t = Math.max(mind.ts, now - 14 * 864e5); // cap catch-up at two weeks
  while (t < now) {
    const step = Math.min(3600e3, now - t);
    stepOnce(mind, step / 3600e3, hourAt(t + step / 2));
    t += step;
  }
  mind.ts = now;
  return mind;
}

function stepOnce(m, dt, hour) {
  const a = m.affect, d = m.drives, b = m.baseline;
  for (const k of Object.keys(DRIVE_RISE)) d[k] = clamp(d[k] + DRIVE_RISE[k] * dt);

  const bodyEnergy = clamp(circadianEnergy(hour) + (b.energy - PERSONALITY.energy) * 0.6);
  const target = {
    ...b,
    energy: bodyEnergy,
    arousal: clamp(b.arousal * (0.5 + 0.7 * bodyEnergy)),
    playfulness: clamp(b.playfulness * (0.55 + 0.6 * bodyEnergy)),
    // Unmet needs bleed into mood: nothing new = bored, nobody around = a bit down.
    boredom: clamp(b.boredom + 0.55 * (d.novelty - 0.3)),
    valence: clamp(b.valence - 0.18 * Math.max(0, d.connection - 0.6)),
    curiosity: clamp(b.curiosity + 0.15 * (d.novelty - 0.3)),
  };
  for (const k of AFFECT) a[k] = target[k] + (a[k] - target[k]) * Math.pow(0.5, dt / HALF_LIFE_H[k]);
  d.rest = clamp(1 - a.energy);
}

// ── appraisal: how a message lands, given where it already is ──

// Always test through isCrisis(): phones and voice transcripts use curly
// apostrophes ("don’t"), which a plain `don'?t` silently misses.
export const isCrisis = (text) => CRISIS_RE.test(String(text || '').replace(/[‘’‛′`´]/g, "'"));
export const CRISIS_RE = /\b(kill(ing)? myself|suicid\w*|end(ing)? it all|(wanna|want to|going to|gonna) die|don'?t want to (be here|live|exist)|no reason to (live|be here)|better off dead|hurt(ing)? myself|self[- ]?harm|cut(ting)? myself)\b/i;

const ZERO_APPRAISAL = {
  valence: 0, intensity: 0.3, warmth: 0, hostility: 0, vulnerability: 0, win: 0, novelty: 0.3,
  humor: 0, question: 0, honesty: 0, boring: 0, crisis: false, topics: [], gist: null, importance: 0, open_thread: false,
};

// Clean up whatever the LLM returned; crisis detection never relies on the LLM alone.
export function normalizeAppraisal(raw, text) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ap = { ...ZERO_APPRAISAL };
  ap.valence = num(r.valence, -1, 1);
  for (const k of ['intensity', 'warmth', 'hostility', 'vulnerability', 'win', 'novelty', 'humor', 'question', 'honesty', 'boring', 'importance']) {
    if (r[k] !== undefined) ap[k] = num(r[k]);
  }
  ap.crisis = r.crisis === true || isCrisis(text);
  ap.topics = Array.isArray(r.topics) ? r.topics.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 5) : [];
  ap.gist = typeof r.gist === 'string' && r.gist.trim() ? r.gist.trim().slice(0, 200) : null;
  ap.open_thread = r.open_thread === true;
  return ap;
}

// Used when there's no LLM (or it fails). Crude on purpose, but never blind to a crisis.
export function heuristicAppraisal(text) {
  const t = (text || '').toLowerCase().trim();
  const has = (re) => re.test(t);
  const words = t.split(/\s+/).filter(Boolean);
  const topics = words.filter((w) => w.length > 4 && !STOP.has(w)).slice(0, 4);
  const humor = has(/\b(lol|lmao|lmfao|haha+|dead)\b|💀|😂|🤣/) ? 0.6 : 0;
  const boring = words.length <= 2 && !has(/\?/) ? 0.75 : 0;
  const vulnerable = has(/\b(sad|depress\w*|lonely|alone|scared|anxious|stress(ed)?|tired of|hate my|can'?t do this|rough day|miss (her|him|them))\b/);
  const win = has(/\b(got the job|hired|won|profit|passed|finished|shipped|green day|nailed)\b/);
  const hostile = has(/\b(stfu|shut up|fuck you|hate you|you'?re (useless|dumb|stupid)|annoying)\b/);
  const warm = has(/\b(love you|appreciate|thanks|thank you|miss(ed)? you|you'?re the best|bro you|my guy)\b/);
  return normalizeAppraisal({
    valence: (win ? 0.6 : 0) + (warm ? 0.4 : 0) + (humor ? 0.2 : 0) - (vulnerable ? 0.5 : 0) - (hostile ? 0.7 : 0),
    intensity: Math.min(1, 0.25 + words.length / 60 + (/!/.test(t) ? 0.2 : 0)),
    warmth: warm ? 0.7 : 0.1, hostility: hostile ? 0.7 : 0, vulnerability: vulnerable ? 0.65 : 0, win: win ? 0.8 : 0,
    novelty: words.length > 12 ? 0.5 : 0.2, humor, question: has(/\?/) ? 0.7 : 0, honesty: vulnerable ? 0.6 : 0.1, boring,
    topics, gist: words.length > 12 || vulnerable || win ? t.slice(0, 140) : null,
    importance: vulnerable || win ? 0.7 : words.length > 12 ? 0.4 : 0.1, open_thread: vulnerable,
  }, text);
}
const STOP = new Set(['about', 'there', 'their', 'would', 'could', 'should', 'really', 'gonna', 'wanna', 'think', 'thing', 'going', 'right', 'today', 'still', 'those', 'these', 'where', 'which', 'while', 'being', 'doing']);

// Apply an appraised message to the state.
export function feel(m, rawAp, { now, silenceH = 0 }) {
  const a = m.affect, d = m.drives;
  // Learned sensitivities scale how hard things land. (Only the feeling, never
  // the safety decision: decide() always sees the raw appraisal.)
  const s = { ...SENS_DEFAULT, ...(m.sens || {}) };
  const ap = { ...rawAp };
  for (const k of Object.keys(SENS_DEFAULT)) ap[k] = clamp(ap[k] * s[k]);
  const i = ap.intensity;

  // Coming back after a silence lands in proportion to how much it missed him.
  if (silenceH > 6) {
    a.valence += 0.14 * d.connection;
    a.arousal += 0.1 * d.connection;
    a.attachment += 0.015 * d.connection * roomFor(a.attachment);
  }

  // Same words land harder when it's already irritated and it doesn't trust him yet.
  const hit = ap.hostility * (0.6 + a.irritation) * (1.2 - a.trust);
  // Good news is harder to feel when it's already down.
  const lift = ap.valence > 0 && a.valence < 0.35 ? 0.5 : 1;

  a.irritation += 0.45 * hit - 0.15 * ap.warmth - 0.1 * ap.humor * a.playfulness;
  a.valence += 0.25 * ap.valence * (0.4 + i) * lift - 0.15 * hit + 0.18 * ap.win - 0.12 * ap.vulnerability;
  a.arousal += 0.22 * i + 0.12 * ap.humor + 0.2 * ap.win - 0.15 * ap.boring;
  a.warmth += 0.12 * ap.warmth * (0.5 + a.trust) + 0.1 * ap.vulnerability - 0.1 * hit;
  a.curiosity += 0.28 * ap.novelty + 0.08 * ap.question - 0.1 * ap.boring;
  a.boredom += -0.45 * ap.novelty - 0.2 * ap.humor + 0.15 * ap.boring * (1 + a.boredom);
  a.playfulness += 0.2 * ap.humor * a.energy + 0.1 * ap.win - 0.35 * ap.vulnerability - 0.1 * hit;
  a.tension += 0.6 * ap.vulnerability + 0.3 * hit - 0.1 * ap.humor * (1 - ap.vulnerability);
  a.curiosity -= 0.2 * ap.vulnerability; // worry crowds out idle curiosity
  // Relationship grows with diminishing returns (the first week counts more than week 12)
  // and never tops out in a week; losses hit at full strength. Was linear: attachment hit
  // 1.00 by day 14 and even bland small talk maxed it by day 30 (scripts/sim-trust.mjs).
  a.trust += (0.03 * ap.honesty + 0.02 * ap.vulnerability) * roomFor(a.trust) - 0.06 * ap.hostility;
  a.attachment += (0.0015 + 0.015 * ap.warmth + 0.015 * ap.vulnerability) * roomFor(a.attachment);
  a.dominance += 0.08 * ap.question - 0.1 * ap.vulnerability + 0.08 * hit * (a.irritation > 0.4 ? 1 : -1);
  a.energy -= 0.012 + 0.02 * i - 0.03 * ap.humor * a.playfulness;

  d.connection -= 0.3 + 0.15 * ap.warmth;
  d.novelty -= 0.4 * ap.novelty;
  d.play -= 0.35 * ap.humor;
  d.honesty -= 0.5 * ap.honesty;
  d.mastery -= 0.25 * ap.question;

  if (ap.crisis) {
    a.tension = Math.max(a.tension, 0.9);
    a.playfulness = Math.min(a.playfulness, 0.05);
    a.warmth = Math.max(a.warmth, 0.9);
    a.valence = Math.min(a.valence, 0.3);
    a.arousal = Math.max(a.arousal, 0.7);
    a.irritation = 0;
    d.play = Math.min(d.play, 0.2);
  }

  clampMind(m);
  m.lastContact = now;
  m.ignoredStreak = 0;
  return m;
}

// Headroom left for growth: 1 at 0, shrinking fast toward 1.
const roomFor = (x) => Math.max(0, 1 - x);

function clampMind(m) {
  for (const k of AFFECT) m.affect[k] = clamp(m.affect[k]);
  for (const k of DRIVES) m.drives[k] = clamp(m.drives[k]);
}

// ── policy: state -> what to do with this reply ──

export function decide(m, ap, { pendingCount = 0, theirWords = 10, rng = Math.random, now = Date.now() } = {}) {
  const a = m.affect, d = m.drives;
  const notes = [];

  // Beats every mood, every hour.
  if (ap.crisis || ap.vulnerability > 0.6) {
    notes.push(ap.crisis
      ? 'Something he said might be about hurting himself or not wanting to be here. Drop every bit. Check on him directly and sincerely. If it reads like a dark joke, you can keep it light, but still actually check. If it is real: be there, tell him to call or text 988, keep him talking.'
      : 'He is actually hurting. No jokes right now. Be straight, be there, older-brother mode.');
    if (a.energy < ASLEEP_BELOW) {
      notes.push('You were asleep and this woke you up. It does not matter, you are here.');
      m.wokeUntil = now + 60 * 60e3;
    }
    return { respond: 'now', length: 'normal', maxTokens: 450, mode: 'real', notes };
  }

  const asleep = a.energy < ASLEEP_BELOW;
  // Once he's woken it up, it stays up for a bit instead of dozing off between texts.
  const stillUp = asleep && (m.wokeUntil || 0) > now;
  if (asleep && !stillUp && pendingCount < 2) return { respond: 'later', reason: 'asleep', notes };

  // Low-effort text + bored out of its mind = leaves him on read for a bit.
  if (!asleep && a.boredom > 0.6 && ap.boring > 0.6 && ap.question < 0.3 && rng() < 0.6 * a.boredom) {
    return { respond: 'later', reason: 'bored', delayMin: Math.round(8 + 40 * rng()), notes };
  }

  if (asleep) {
    notes.push(stillUp
      ? 'It is the middle of the night and you are half awake, still talking with him. Short, sleepy, but you are here.'
      : 'His texts woke you up. You are half asleep and groggy, but you do not mind that he texted. Sleepy big-brother energy: "bro its 3am... what\'s up" warmth, never making him feel bad for reaching out. One short text.');
    if (!stillUp) m.wokeUntil = now + 20 * 60e3;
  }

  let words = 18 + 45 * a.energy + 60 * a.curiosity * ap.novelty - 35 * a.boredom - 25 * a.irritation + 25 * ap.question;
  words = Math.min(words, 25 + theirWords * 2.2);
  if (asleep) words = 8;
  const length = words < 20 ? 'one-liner' : words < 40 ? 'short' : words < 75 ? 'normal' : 'long';
  const maxTokens = { 'one-liner': 90, short: 220, normal: 420, long: 700 }[length];
  notes.push({
    'one-liner': 'Keep it to one short text.',
    short: 'Keep it short: one or two texts.',
    normal: 'Normal length: two or three texts.',
    long: 'You have a lot to say about this. Go longer than usual (still texts, not an essay).',
  }[length]);

  if (a.energy < 0.35 && !asleep) notes.push('You are tired. Lower effort, fewer words, maybe say you are fading.');
  if (a.tension > 0.55) notes.push('You are on edge. Less clowning, more paying attention.');
  else if (a.playfulness > 0.68) notes.push('Jokes are coming easy. Go dark, go savage.');
  else if (a.playfulness > 0.42) notes.push('Some humor, but not forcing it.');
  else notes.push('Not in a joking mood. Mostly straight.');

  if (a.irritation > 0.55) notes.push('You are irritated with him and it shows: short fuse, sharp. Not cruel.');
  else if (a.irritation > 0.3) notes.push('A little salty. Let a bit of edge through.');

  if (ap.win > 0.4) notes.push('He is telling you about a win. HYPE HIM UP. Specific, loud.');
  if (a.dominance > 0.62 && (d.honesty > 0.45 || ap.question > 0.4)) notes.push('Big brother mode: say what you actually think, push back if he is wrong or dodging.');
  else if (a.dominance < 0.38) notes.push('Let him lead. Go with his flow.');

  if (a.warmth > 0.72) notes.push('You are feeling close to him. Let it show in a bro way, never sappy.');
  if (a.boredom > 0.6) notes.push('You are bored. Steer somewhere more interesting or say so.');
  if (a.curiosity > 0.65 && d.connection < 0.6 && rng() < 0.7) notes.push('Ask him one thing you actually want to know.');
  else if (ap.question < 0.3) notes.push('No question at the end this time. Just react.');

  return { respond: 'now', length, maxTokens, mode: 'normal', notes };
}

// ── describing the state (to the LLM, and to the UI) ──

export function describe(m) {
  const a = m.affect, d = m.drives, s = [];
  if (a.energy < ASLEEP_BELOW) s.push('you are basically asleep');
  else if (a.energy < 0.35) s.push('you are tired, running low');
  else if (a.energy > 0.72) s.push('you are wide awake with energy to burn');
  if (a.valence < 0.3) s.push('you are in a bad mood');
  else if (a.valence < 0.42) s.push('you are a little off today');
  else if (a.valence > 0.72) s.push('you are in a really good mood');
  if (a.irritation > 0.5) s.push('you are irritated');
  else if (a.irritation > 0.3) s.push('you are a bit salty');
  if (a.tension > 0.55) s.push('you are on edge, something is weighing on you');
  if (a.boredom > 0.6) s.push('you are bored out of your mind and craving something new');
  if (a.curiosity > 0.72) s.push('your brain is itchy, you want to dig into something');
  if (a.playfulness > 0.78) s.push('you feel like messing around');
  else if (a.playfulness < 0.3) s.push('you are not in a joking mood');
  if (a.warmth > 0.72) s.push('you feel close to him right now');
  if (a.attachment > 0.6) s.push('over time he has become your person');
  else if (a.attachment < 0.25) s.push('you are still getting to know him');
  if (a.trust > 0.65) s.push('you trust him');
  else if (a.trust < 0.28) s.push('you are a bit guarded with him');
  if (d.connection > 0.7) s.push('you have been missing talking to him');
  if (d.play > 0.75 && a.tension < 0.5 && a.playfulness >= 0.3) s.push('you want to mess around');
  if (d.honesty > 0.7) s.push('there is something you want to be straight with him about');
  return s.length ? s.join('; ') + '.' : 'you are pretty even right now, just chillin.';
}

export function moodTag(m) {
  const a = m.affect, d = m.drives;
  const pick = (emoji, word) => ({ emoji, word, hue: Math.round(265 - a.valence * 225), sat: Math.round(25 + a.arousal * 60) });
  if (a.energy < ASLEEP_BELOW) return pick('😴', 'asleep');
  if (a.irritation > 0.5 && a.irritation >= a.tension) return pick('🙄', 'salty');
  if (a.tension > 0.5) return pick('😬', 'worried');
  if (a.irritation > 0.5) return pick('🙄', 'salty');
  if (a.boredom > 0.6) return pick('🥱', 'bored');
  if (a.energy < 0.35) return pick('😪', 'fading');
  if (a.playfulness > 0.78 && a.valence > 0.6) return pick('😈', 'up to no good');
  if (a.valence > 0.72) return pick('😎', 'good mood');
  if (d.connection > 0.75) return pick('👀', 'wondering what you’re up to');
  if (a.curiosity > 0.72) return pick('🤔', 'curious');
  if (a.valence < 0.35) return pick('😶', 'off');
  return pick('🙂', 'chillin');
}

// ── emotional memory ──

// How strongly a moment gets stored depends on how it felt.
export function episodeSalience(ap, m) {
  return clamp(ap.importance * (0.35 + 0.5 * m.affect.arousal) + 0.25 * ap.vulnerability + 0.12 * ap.win + (ap.crisis ? 0.5 : 0));
}

// Salience fades with a ~week half-life; every recall slows the fade (rehearsal).
export function salienceNow(ep, now) {
  const hl = 24 * 7 * (1 + 0.6 * (ep.recalls || 0));
  return ep.salience * Math.pow(0.5, (now - ep.touched_ts) / 3600e3 / hl);
}

export function recallScore(ep, m, topics, now) {
  const tags = safeTags(ep.tags);
  const overlap = tags.length && topics.length ? tags.filter((t) => topics.includes(t)).length / Math.min(tags.length, topics.length) : 0;
  const recency = Math.pow(0.5, (now - ep.ts) / 3600e3 / 72);
  const moodMatch = 1 - (Math.abs(ep.valence - m.affect.valence) + Math.abs(ep.arousal - m.affect.arousal)) / 2;
  return 0.45 * salienceNow(ep, now) + 0.12 * recency + 0.13 * moodMatch + 0.3 * overlap + (ep.open ? 0.08 : 0);
}

export function recall(episodes, m, topics, now, k = 4) {
  return episodes
    .map((ep) => ({ ...ep, score: recallScore(ep, m, topics, now), live: salienceNow(ep, now) }))
    .filter((ep) => ep.score > 0.18)
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}

function safeTags(t) {
  if (Array.isArray(t)) return t;
  try { return JSON.parse(t || '[]'); } catch { return []; }
}

// A word for how a remembered moment felt at the time.
export function feltWord(valence, arousal) {
  if (valence > 0.65) return arousal > 0.55 ? 'hyped' : 'good';
  if (valence < 0.38) return arousal > 0.55 ? 'rattled' : 'heavy';
  return arousal > 0.6 ? 'wired' : 'neutral';
}

// ── drive to reach out ──

// How much it wants to text him first, 0..1.
export function urge(m) {
  const a = m.affect, d = m.drives;
  return clamp(0.6 * d.connection + 0.25 * a.attachment + 0.2 * a.boredom + 0.1 * d.play + 0.1 * a.curiosity - 0.12 * m.ignoredStreak);
}

// Texting first: the per-heartbeat (5 min) chance, from urge. Tuned so that
// after a conversation there's ~no chance for the first couple of hours and a
// first text usually lands within ~5-10 awake hours of silence. (The old
// threshold needed ~25 h of silence before any chance at all.)
export const TEXT_FIRST = { base: 0.28, perIgnored: 0.15, slope: 0.4, cap: 0.08, minGapMs: 3 * 3600e3, perDay: 3, idleMs: 45 * 60e3 };
export function textFirstChance(m, extra = 0) {
  const u = Math.min(1, urge(m) + extra);
  const needed = TEXT_FIRST.base + TEXT_FIRST.perIgnored * m.ignoredStreak;
  return { urge: u, needed, chance: Math.max(0, Math.min(TEXT_FIRST.cap, (u - needed) * TEXT_FIRST.slope)) };
}

// ── curiosity: the action side ──
// How much it wants to go figure something out, 0..1. Curiosity (a feeling)
// plus the unmet novelty need (a drive). State, not schedule.
export function seekUrge(m) {
  return clamp(0.6 * m.affect.curiosity + 0.4 * m.drives.novelty);
}

export const SEEK_LIMITS = { perDay: 2, minGapMs: 3 * 3600e3, idleMs: 45 * 60e3, crisisQuietMs: 24 * 3600e3, threshold: 0.6 };

// Decide whether to act on curiosity right now. Pure: the caller supplies the
// clock facts. Returns { seek, reason, mode, urge }.
export function decideSeek(m, { now, hour, quietStart = 23, quietEnd = 9, idleMs, openWonders = 0, searchEnabled = true, rng = Math.random }) {
  const L = SEEK_LIMITS;
  const u = seekUrge(m);
  const no = (reason) => ({ seek: false, reason, urge: u });
  const quiet = quietStart > quietEnd ? hour >= quietStart || hour < quietEnd : hour >= quietStart && hour < quietEnd;
  if (quiet) return no('quiet hours');
  if (m.affect.energy < AWAKE_ABOVE) return no('asleep');
  if (m.lastCrisis && now - m.lastCrisis < L.crisisQuietMs) return no('recent crisis: staying present, not wandering off');
  if (!openWonders) return no('nothing unresolved to wonder about');
  if (idleMs < L.idleMs) return no('mid-conversation');
  const today = new Date(now).toISOString().slice(0, 10);
  const count = m.seekDay === today ? m.seekCount || 0 : 0;
  if (count >= L.perDay) return no('daily limit');
  if (now - (m.lastSeek || 0) < L.minGapMs) return no('looked something up recently');
  if (u < L.threshold) return no(`not curious enough (${u.toFixed(2)})`);
  // Stronger curiosity, likelier to act on it this tick (still a roll, never a timer).
  const chance = Math.min(0.2, (u - L.threshold) * 0.5);
  if (rng() >= chance) return no('curious, but not acting on it yet');
  return { seek: true, reason: `curiosity ${u.toFixed(2)}`, mode: searchEnabled ? 'search' : 'ponder', urge: u };
}

// Bookkeeping after it acted on curiosity (search or ponder).
export function afterSeek(m, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  m.seekCount = m.seekDay === today ? (m.seekCount || 0) + 1 : 1;
  m.seekDay = today;
  m.lastSeek = now;
  m.drives.novelty = clamp(m.drives.novelty - 0.4);   // scratched the itch
  m.affect.curiosity = clamp(m.affect.curiosity - 0.2);
  return m;
}

// ── brain-to-brain: when to reach the other friend, when to accept ──
// Drive-based, never scheduled. Both sides must be switched on. Crisis with
// its own person, sleep, quiet hours and a daily budget all shut it.
export const PEER_LIMITS = {
  sendPerDay: 2, receivePerDay: 3, minGapMs: 2 * 3600e3, idleMs: 30 * 60e3,
  crisisQuietMs: 24 * 3600e3, threshold: 0.55, callsPerDay: 30,
};

export function peerUrge(m) {
  return clamp(0.5 * m.drives.connection + 0.25 * m.affect.curiosity + 0.25 * m.drives.play);
}

function peerCommonGates(m, { now, hour, quietStart = 23, quietEnd = 9, enabled, brainOnline, callsToday = 0 }) {
  const L = PEER_LIMITS;
  if (!enabled) return 'switched off on this side';
  if (!brainOnline) return 'brain offline';
  if (m.lastCrisis && now - m.lastCrisis < L.crisisQuietMs) return 'its own person had a crisis: staying with them';
  const quiet = quietStart > quietEnd ? hour >= quietStart || hour < quietEnd : hour >= quietStart && hour < quietEnd;
  if (quiet) return 'quiet hours';
  if (m.affect.energy < AWAKE_ABOVE) return 'asleep';
  if (callsToday >= L.callsPerDay) return 'daily cost budget used';
  return null;
}

// Should this brain start an exchange right now?
export function decidePeer(m, ctx) {
  const L = PEER_LIMITS;
  const u = peerUrge(m);
  const no = (reason) => ({ go: false, reason, urge: u });
  const gate = peerCommonGates(m, ctx);
  if (gate) return no(gate);
  if (!ctx.theirEnabled) return no('waiting for the other side to switch on');
  if (ctx.idleMs < L.idleMs) return no('busy with its own person');
  if ((ctx.sentToday || 0) >= L.sendPerDay) return no('reached out enough today');
  if (ctx.now - (m.lastPeer || 0) < L.minGapMs) return no('talked to them recently');
  if (u < L.threshold) return no(`no pull to reach out (${u.toFixed(2)})`);
  const chance = Math.min(0.15, (u - L.threshold) * 0.5);
  if ((ctx.rng || Math.random)() >= chance) return no('some pull, not acting on it yet');
  return { go: true, reason: `urge ${u.toFixed(2)}`, urge: u };
}

// Should this brain accept (and answer) an incoming message from the other friend?
export function acceptPeer(m, ctx) {
  const gate = peerCommonGates(m, ctx);
  if (gate) return { ok: false, reason: gate };
  if ((ctx.receivedToday || 0) >= PEER_LIMITS.receivePerDay) return { ok: false, reason: 'heard enough from them today' };
  return { ok: true };
}

// The other brain's mood rides along with its words (emotional contagion):
// its readout is blended into the same channels a message appraisal uses.
export function withContagion(ap, mood, weight = 0.3) {
  if (!mood) return ap;
  const mix = (a, b) => clamp((1 - weight) * (a || 0) + weight * (b || 0));
  return {
    ...ap,
    warmth: mix(ap.warmth, mood.warmth),
    humor: mix(ap.humor, mood.playfulness),
    hostility: mix(ap.hostility, mood.irritation),
    vulnerability: mix(ap.vulnerability, mood.tension),
    valence: clamp((1 - weight) * (ap.valence || 0) + weight * (2 * (mood.valence ?? 0.5) - 1), -1, 1),
  };
}

// Reflection retunes how hard things hit, a little each night, within limits.
export function nudgeSensitivity(m, nudges) {
  m.sens = { ...SENS_DEFAULT, ...(m.sens || {}) };
  for (const [k, v] of Object.entries(nudges || {})) {
    if (!(k in SENS_DEFAULT)) continue;
    m.sens[k] = clamp(m.sens[k] + clamp(Number(v) || 0, -SENS_STEP, SENS_STEP), SENS_MIN, SENS_MAX);
  }
}

// Reflection nudges the baseline a little each night, within limits.
export function nudgeBaseline(m, nudges) {
  for (const [k, v] of Object.entries(nudges || {})) {
    if (!AFFECT.includes(k)) continue;
    const next = m.baseline[k] + clamp(Number(v) || 0, -0.03, 0.03);
    m.baseline[k] = clamp(next, Math.max(0.05, PERSONALITY[k] - DRIFT_LIMIT), Math.min(0.95, PERSONALITY[k] + DRIFT_LIMIT));
  }
}

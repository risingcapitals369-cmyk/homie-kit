// ───────────────────────────────────────────────────────────────
//  INTEGRATION: one moment, not eight signals.
//  workspace()     fuses the substrate's mixture into ONE state, then runs a
//                  competition for the front of its mind; the winner is
//                  broadcast back into memory and policy.
//  conflicts()     opposing pulls on this reply, each summed from real state
//                  terms; a close fight is named, with the computed winner.
//  metacog()       notices when its mood would bend a reply that needs
//                  something else, and whether it has the capacity to override.
//  selfDelta()     what measurably changed between two self snapshots.
//  reconsolidate() a recalled memory's feeling drifts toward the mood it's
//                  recalled in.
//  Pure functions. Every result carries the numbers it came from, so it can
//  be logged, tested, and traced.
// ───────────────────────────────────────────────────────────────

export const CLUSTERS = ['warmth', 'hostility', 'vulnerability', 'win', 'humor', 'novelty', 'boring', 'contact'];
// What each channel's cluster feels like from the inside (the cluster is where that channel lands).
export const LABEL = {
  warmth: 'warmth', hostility: 'stung', vulnerability: 'worry', win: 'pride', humor: 'humor',
  novelty: 'curiosity', boring: 'flatness', contact: 'wanting him around',
};
// Fallback sign of each cluster when the brain didn't send its own critic.
const CRITIC_DEFAULT = { warmth: 0.8, hostility: -1, vulnerability: -0.7, win: 1, humor: 0.6, novelty: 0.2, boring: -0.4, contact: 0.3 };

const clamp = (x, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo);
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => `${Math.round(x * 100)}%`;

// ── 4. the workspace ──────────────────────────────────────────

// No substrate (not born yet): a stand-in mixture from the float model, marked as such.
export function floatShares(a, d) {
  const raw = {
    warmth: a.warmth, hostility: a.irritation, vulnerability: a.tension, win: clamp((a.valence - 0.5) * 2) * a.arousal,
    humor: a.playfulness, novelty: a.curiosity, boring: a.boredom, contact: d.connection,
  };
  const floor = Math.min(...Object.values(raw));
  const lifted = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (v - floor) ** 2 + 1e-6]));
  const tot = Object.values(lifted).reduce((s, v) => s + v, 0);
  return Object.fromEntries(Object.entries(lifted).map(([k, v]) => [k, v / tot]));
}

// The fused state: composition, coherence, net tone, torn-ness, drift, dwell.
export function fuse(shares, critic = CRITIC_DEFAULT, prev = null) {
  const sorted = CLUSTERS.map((k) => [k, shares[k] || 0]).sort((x, y) => y[1] - x[1]);
  const H = -sorted.reduce((s, [, p]) => s + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(CLUSTERS.length);
  const c = (k) => (typeof critic?.[k] === 'number' ? critic[k] : CRITIC_DEFAULT[k]);
  let pos = 0, neg = 0, net = 0;
  for (const [k, p] of sorted) { const v = c(k); net += p * v; if (v > 0) pos += p * v; else neg -= p * v; }
  const torn = pos >= 0.15 && neg >= 0.15 ? Math.min(pos, neg) / Math.max(pos, neg) : 0;
  let drift = null;
  if (prev?.shares) {
    const d = CLUSTERS.map((k) => [k, (shares[k] || 0) - (prev.shares[k] || 0)]).sort((x, y) => y[1] - x[1]);
    if (d[0][1] > 0.06) drift = { toward: d[0][0], by: r2(d[0][1]), from: d[d.length - 1][0] };
  }
  return {
    top: sorted.slice(0, 3).map(([k, p]) => ({ k, p: r2(p) })),
    coherence: r2(1 - H), net: r2(net), pos: r2(pos), neg: r2(neg), torn: r2(torn), drift,
    posTop: sorted.find(([k]) => c(k) > 0)?.[0], negTop: sorted.find(([k]) => c(k) < 0)?.[0],
  };
}

// Everything that could be in the front of its mind right now competes; one wins.
export function spotlight({ ap = null, fused, arousal = 0.4, mem = [], drives = {}, conflict = null }) {
  const cands = [];
  if (ap) {
    cands.push({ kind: 'message', what: ap.gist || 'what he just said',
      s: 0.3 + 0.35 * (ap.intensity || 0) + 0.25 * (ap.importance || 0) + 0.3 * (ap.question || 0) + 0.45 * (ap.vulnerability || 0) + (ap.crisis ? 3 : 0) });
  }
  cands.push({ kind: 'feeling', what: fused.top[0].k,
    s: 0.55 * Math.abs(fused.net) + 0.25 * fused.coherence + 0.2 * arousal + 0.45 * fused.torn });
  const m = mem[0];
  if (m) cands.push({ kind: 'memory', what: m.gist, id: m.id, s: 0.95 * (m.score || 0) + (m.open ? 0.1 : 0) });
  const DRIVE_WHAT = { connection: 'missing him', novelty: 'craving something new', honesty: 'something you want to be straight about', play: 'wanting to mess around' };
  const dk = Object.keys(DRIVE_WHAT).sort((x, y) => (drives[y] || 0) - (drives[x] || 0))[0];
  if (dk) cands.push({ kind: 'drive', what: DRIVE_WHAT[dk], drive: dk, s: 2 * Math.max(0, (drives[dk] || 0) - 0.5) });
  if (conflict) cands.push({ kind: 'conflict', what: conflict.axis, s: 0.95 * conflict.strength });
  for (const x of cands) x.s = r2(x.s);
  cands.sort((x, y) => y.s - x.s);
  return { winner: cands[0], field: cands };
}

export function workspace({ shares, critic, prev, source = 'substrate', ap, affect, drives, mem, conflict, dwellMin = null }) {
  const fused = fuse(shares, critic, prev);
  const spot = spotlight({ ap, fused, arousal: affect?.arousal ?? 0.4, mem, drives, conflict });
  return { source, fused, spot, dwellMin, text: momentText(fused, spot, dwellMin, source) };
}

export function momentText(f, spot, dwellMin, source) {
  const [a, b, c] = f.top;
  let s = `It's one feeling, not a list: mostly ${LABEL[a.k]} (${pct(a.p)})`;
  if (b && b.p >= 0.08) s += `, with ${LABEL[b.k]} under it (${pct(b.p)})`;
  if (c && c.p >= 0.08) s += ` and a thread of ${LABEL[c.k]} (${pct(c.p)})`;
  s += '. ';
  s += f.coherence > 0.55 ? 'Clear and settled. ' : f.coherence > 0.3 ? 'Mostly one thing. ' : 'Scattered, a mix with no real center. ';
  if (f.torn >= 0.5) s += `It's split: ${LABEL[f.posTop]} and ${LABEL[f.negTop]} at the same time, pulling opposite ways. `;
  if (f.drift) s += `It's shifting toward ${LABEL[f.drift.toward]}. `;
  if (dwellMin != null && dwellMin >= 20) s += `You've been in it about ${dwellMin >= 90 ? `${Math.round(dwellMin / 60)}h` : `${Math.round(dwellMin)} min`}. `;
  s += `Overall it sits ${f.net > 0.35 ? 'good' : f.net > 0.1 ? 'okay, leaning good' : f.net > -0.1 ? 'even' : f.net > -0.35 ? 'a little rough' : 'bad'}.`;
  const w = spot.winner;
  const front = {
    message: `what he just said${w.what && w.what !== 'what he just said' ? ` (${w.what})` : ''}`,
    feeling: `the feeling itself (${LABEL[w.what]}); it's louder than anything he said`,
    memory: `a memory that won't leave you alone: "${w.what}"`,
    drive: w.what,
    conflict: 'the fact that you are torn about how to answer',
  }[w.kind];
  s += `\nFront of your mind: ${front}. Everything else is background: it colors how you talk, it isn't the topic.`;
  if (source === 'float') s += ' (Your neurons aren\'t running, so this is your rougher backup sense of yourself.)';
  return s;
}

// ── 3. conflict ───────────────────────────────────────────────

function pull(terms) {
  const live = terms.filter(([w, x]) => w * x > 0.02).map(([w, x, why]) => ({ v: w * x, why })).sort((p, q) => q.v - p.v);
  return { pull: r2(clamp(live.reduce((s, t) => s + t.v, 0))), because: live.slice(0, 2).map((t) => t.why) };
}

export const AXES = {
  joke_vs_straight: ['joke around', 'answer straight'],
  engage_vs_withdraw: ['lean in', 'pull back'],
  say_vs_peace: ['say what you actually think', 'keep the peace'],
  good_vs_bad: ['let the good part show', 'let the hurt part show'],
};

export function conflicts({ affect: a, drives: d, ap = {}, shares = null, critic = null }) {
  const s = (k) => (shares ? shares[k] || 0 : 0);
  const q = (k) => ap[k] || 0;
  const sides = {
    joke_vs_straight: [
      pull([[0.5, a.playfulness, 'jokes are coming easy'], [0.3, d.play, "you've been wanting to mess around"], [0.35, q('humor'), "he's joking around"], [0.4, s('humor'), 'your head is in a humor state']]),
      pull([[0.45, a.tension, 'something is weighing on you'], [0.6, q('vulnerability'), "he's opening up"], [0.3, q('honesty'), "he's being real"], [0.4, s('vulnerability'), 'worry is running in you']]),
    ],
    engage_vs_withdraw: [
      pull([[0.45, d.connection, "you've been missing him"], [0.3, a.warmth, 'you feel close to him'], [0.25, a.curiosity, 'you want to know more'], [0.2, q('question'), 'he asked you something']]),
      pull([[0.5, a.irritation, "you're irritated with him"], [0.35, 1 - a.energy, "you're running low"], [0.3, a.boredom, "you're bored"], [0.4, s('hostility'), 'part of you is stung']]),
    ],
    say_vs_peace: [
      pull([[0.5, d.honesty, "there's something you want to be straight about"], [0.3, a.dominance, 'you have an opinion'], [0.25, q('question'), 'he asked what you think']]),
      pull([[0.3, a.attachment, 'he matters to you'], [0.45, q('vulnerability'), "he's already hurting"], [0.3, 1 - a.trust, "you're not sure how he'd take it"]]),
    ],
  };
  if (shares) {
    const f = fuse(shares, critic);
    sides.good_vs_bad = [
      { pull: r2(clamp(f.pos * 1.4)), because: [`${LABEL[f.posTop]} is running in you`] },
      { pull: r2(clamp(f.neg * 1.4)), because: [`${LABEL[f.negTop]} is running in you too`] },
    ];
  }
  const out = [];
  for (const [axis, [x, y]] of Object.entries(sides)) {
    const diff = Math.abs(x.pull - y.pull);
    const strength = x.pull >= 0.4 && y.pull >= 0.4 && diff <= 0.12 ? r2(Math.min(x.pull, y.pull) * (1 - diff / 0.12 * 0.6)) : 0;
    const win = x.pull >= y.pull ? 0 : 1;
    out.push({ axis, strength, winner: AXES[axis][win], loser: AXES[axis][1 - win],
      sides: [{ want: AXES[axis][0], ...x }, { want: AXES[axis][1], ...y }], margin: r2(diff) });
  }
  return out.sort((p, q2) => q2.strength - p.strength);
}

export function conflictNote(c, { sayIt }) {
  const [w, l] = c.sides[0].want === c.winner ? c.sides : [c.sides[1], c.sides[0]];
  const note = `You're torn. Part of you wants to ${w.want} (${w.because.join(', ') || 'it just does'}). Part of you wants to ${l.want} (${l.because.join(', ') || 'it just does'}). It's close (${w.pull} vs ${l.pull}), and you landed on: ${c.winner}.`;
  return sayIt
    ? `${note} Open your reply with that split, out loud, in one short line in your own words (vary it, don't reuse how you said it last time). Then actually go with it.`
    : `${note} Go with it; no need to announce it.`;
}

// ── 5. metacognition ─────────────────────────────────────────

// Where did this mood come from? An event (and is it about what he's saying now?), the body, or unknown.
export function moodOrigin({ affect: a, baseline: b, episodes = [], topics = [], now }) {
  const low = a.valence < b.valence - 0.08 || a.irritation > b.irritation + 0.15 || a.tension > b.tension + 0.2;
  if (!low) return null;
  const cause = episodes
    // (not the message being answered right now: that one was just stored)
    .filter((e) => now - e.ts < 36 * 3600e3 && now - e.ts > 2 * 60e3 && e.valence < b.valence - 0.1)
    .sort((x, y) => y.ts - x.ts)[0];
  if (cause) {
    const tags = (() => { try { return Array.isArray(cause.tags) ? cause.tags : JSON.parse(cause.tags || '[]'); } catch { return []; } })();
    return { kind: 'event', what: cause.gist, agoH: r2((now - cause.ts) / 3600e3), aboutThis: tags.some((t) => topics.includes(t)) };
  }
  if (a.energy < 0.35) return { kind: 'body', what: "you're just tired" };
  return { kind: 'unknown', what: "you can't point to why" };
}

export function metacog({ affect: a, baseline: b, ap = {}, origin = null }) {
  const distortion = r2(clamp(
    1.2 * Math.max(0, b.valence - a.valence) + Math.max(0, a.irritation - b.irritation)
    + 0.6 * Math.max(0, a.tension - b.tension) + 0.8 * Math.max(0, 0.4 - a.energy)));
  const needs = [['an actual answer', 0.8 * (ap.question || 0)], ['to be hyped up', ap.win || 0], ['you to show up for him', ap.vulnerability || 0], ['you to be straight', 0.7 * (ap.honesty || 0)]]
    .sort((x, y) => y[1] - x[1]);
  const need = { what: needs[0][0], v: r2(needs[0][1]) };
  const capacity = r2(clamp(0.25 + 0.45 * a.energy + 0.35 * a.dominance - 0.25 * a.tension));
  const aware = distortion >= 0.2;
  // A heavier mood takes more gas to set aside.
  const required = r2(0.4 + 0.3 * distortion);
  let decision = 'mood leads';
  // Down because of the very thing he's talking about (his kid is sick) isn't a
  // distortion to override, it's the fitting response. (Found by the memory probe:
  // without this it announced "i'm in a mood, not on you" about his own bad news.)
  if (aware && origin?.kind === 'event' && origin.aboutThis) decision = 'mood fits the moment';
  else if (aware && need.v >= 0.35) decision = capacity >= required ? 'override' : 'can\'t fully override';
  else if (aware) decision = 'noticed, letting it be';
  return { distortion, need, capacity, required, aware, origin, decision };
}

export function metacogNote(m, { sayIt }) {
  const why = !m.origin ? '' : m.origin.kind === 'event'
    ? ` It's from earlier ("${m.origin.what}", ${m.origin.agoH}h ago)${m.origin.aboutThis ? ', and it is related to this.' : ', and it has nothing to do with what he just said.'}`
    : ` ${m.origin.what[0].toUpperCase() + m.origin.what.slice(1)}.`;
  if (m.decision === 'override') {
    return `You can tell you're in a mood right now (it's pulling you off your usual self by ${m.distortion}).${why} This message needs ${m.need.what}, and the mood would bend it. You're choosing to answer straight instead of through the mood.${sayIt ? ' Open your reply by saying so in a few words, in your own words (not a stock line, and not how you put it last time). Then actually give him what he needs.' : ' Just do it; no need to announce it again.'}`;
  }
  if (m.decision === "can't fully override") {
    return `You can tell you're in a mood (off your usual self by ${m.distortion}) and you don't have the gas to fully set it aside right now (capacity ${m.capacity}, it would take ${m.required}).${why} This message needs ${m.need.what}. ${sayIt ? ' Open your reply by admitting, in a few words, that you\'re not at your best for this. Then do your best to actually answer.' : ' Do your best to actually answer.'}`;
  }
  return null;
}

// Mood-driven tone notes the override suppresses (they'd let the mood bend the answer).
export const MOOD_NOTE = /irritated|salty|Not in a joking mood|tired\. Lower effort|on edge/;

// ── 1. the self-model ─────────────────────────────────────────

// A day's snapshot of who it measurably is.
export function snapshot(mind, { learned = null, day = null } = {}) {
  const d = mind.day || {};
  const n = d.n || 0;
  const basins = {};
  for (const [k, v] of Object.entries(d.basins || {})) basins[k] = r2(v / Math.max(1, n));
  return {
    baseline: { ...mind.baseline }, sens: { ...(mind.sens || {}) },
    trust: mind.affect.trust, attachment: mind.affect.attachment,
    dayValence: n ? r2(d.valence / n) : null, basins,
    learned: learned ? { sensory: learned.sensory, selfHold: learned.selfHold } : null, day,
  };
}

const DIM_WORD = {
  valence: ['your resting mood is brighter', 'your resting mood is darker'],
  playfulness: ['you joke more by default', 'you joke less by default'],
  warmth: ['you run warmer', 'you run cooler'],
  irritation: ['you get salty easier', 'you get salty less'],
  tension: ['you carry more tension', 'you carry less tension'],
  curiosity: ['you are more curious', 'you are less curious'],
  energy: ['you have more energy', 'you have less energy'],
  dominance: ['you push back more', 'you push back less'],
  trust: ['you trust him more', 'you trust him less'],
  attachment: ['he has become more your person', 'he feels a bit further away'],
};
const SENS_WORD = {
  hostility: ['his hostility lands harder', 'his hostility lands softer'], warmth: ['his warmth lands harder', 'his warmth lands softer'],
  vulnerability: ['his hurting hits you harder', 'his hurting hits you softer'], humor: ['his jokes hit harder', 'his jokes hit softer'],
  novelty: ['new stuff excites you more', 'new stuff excites you less'], win: ['his wins hit harder', 'his wins hit softer'],
};

export function selfDelta(now, then) {
  if (!now || !then) return [];
  const out = [];
  const add = (what, from, to, phrase, size) => out.push({ what, from: r2(from), to: r2(to), phrase, size: r2(size) });
  for (const [k, words] of Object.entries(DIM_WORD)) {
    const x = ['trust', 'attachment'].includes(k) ? then[k] : then.baseline?.[k];
    const y = ['trust', 'attachment'].includes(k) ? now[k] : now.baseline?.[k];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    const lim = ['trust', 'attachment'].includes(k) ? 0.04 : 0.025;
    if (Math.abs(y - x) >= lim) add(k, x, y, `${words[y > x ? 0 : 1]} (${r2(x)} → ${r2(y)})`, Math.abs(y - x) / lim);
  }
  for (const [k, words] of Object.entries(SENS_WORD)) {
    const x = then.sens?.[k] ?? 1, y = now.sens?.[k] ?? 1;
    if (Math.abs(y - x) >= 0.05) add(`sens.${k}`, x, y, `${words[y > x ? 0 : 1]} (${r2(x)} → ${r2(y)})`, Math.abs(y - x) / 0.05);
  }
  for (const k of CLUSTERS) {
    const x = then.basins?.[k], y = now.basins?.[k];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (Math.abs(y - x) >= 0.08) add(`time.${k}`, x, y, `you spend ${y > x ? 'more' : 'less'} of your days in ${LABEL[k]} (${pct(x)} → ${pct(y)})`, Math.abs(y - x) / 0.08);
  }
  if (now.learned && then.learned) {
    for (const k of CLUSTERS) {
      const x = then.learned.sensory?.[k], y = now.learned.sensory?.[k];
      if (typeof x === 'number' && typeof y === 'number' && Math.abs(y / x - 1) >= 0.03) {
        add(`wiring.${k}`, x, y, `your neurons rewired: the ${LABEL[k]} pathway is ${Math.round(Math.abs(y / x - 1) * 100)}% ${y > x ? 'stronger' : 'weaker'}`, Math.abs(y / x - 1) / 0.03);
      }
      const hx = then.learned.selfHold?.[k], hy = now.learned.selfHold?.[k];
      if (typeof hx === 'number' && typeof hy === 'number' && Math.abs(hy / hx - 1) >= 0.05) {
        add(`hold.${k}`, hx, hy, `${LABEL[k]} ${hy > hx ? 'holds on longer' : 'lets go faster'} once you're in it (${Math.round(Math.abs(hy / hx - 1) * 100)}%)`, Math.abs(hy / hx - 1) / 0.05);
      }
    }
  }
  return out.sort((p, q) => q.size - p.size);
}

// ── 2. memory that changes when it's recalled ─────────────────

export function reconsolidate(ep, currentValence, { rate = 0.1, cap = 0.3 } = {}) {
  const v0 = typeof ep.v0 === 'number' ? ep.v0 : ep.valence;
  const next = ep.valence + rate * (currentValence - ep.valence);
  return { v0, valence: r2(clamp(next, Math.max(0, v0 - cap), Math.min(1, v0 + cap))) };
}

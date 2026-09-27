// ───────────────────────────────────────────────────────────────
//  BRAIN: the glue between real life and the substrate.
//  - Time: 1 simulated second per real minute (so a day = 1440 sim-s,
//    ~4 CPU-minutes at full size). Long gaps (PC off) are capped and
//    experienced as a blackout.
//  - Senses: an appraised message becomes 1 sim-second of Poisson input on
//    the matching channels, plus the "contact" channel (he texted at all).
//  - Chemistry: drives + energy from the app set the neuromodulators.
//  - Readout: decode the state the network settles into after the input.
//  Pure functions over the network object; the service does the I/O.
// ───────────────────────────────────────────────────────────────
import {
  createNetwork, run, setInput, modulate, calibrateDecoder, decode, cloneNetwork, reinforce, CHANNELS,
} from './snn.js';

export const REAL_MS_PER_SIM_MS = 60;
export const MAX_CATCHUP_REAL_MS = 6 * 3600e3;   // beyond this, time just jumps (blackout)
export const STIM_MS = 1000;
export const READ_MS = 1000;

// Appraisal (0..1 fields from the app) -> input firing rates (Hz).
// Staged, off: it changes how the brain-to-brain test learns (test/peer.test.mjs). See TUNING.md.
const DRY_TEXT_SCALING = false;
export function inputFor(ap) {
  // Something it found on its own (ap.world) or heard from the other friend
  // (ap.peer) isn't contact with its person. Same 8 channels, no new ones.
  // How much a text matters scales how hard it hits: a dry "yo" can dent the mood,
  // it shouldn't replace it for the next 17 hours (neuro/tools/capture.mjs).
  // importance >= 0.6 (or missing) = full strength, <= 0.3 ("yo", "wyd") = 40%. Crisis always full.
  // NOT WIRED YET: the Worker does not send importance (NEURO_FIELDS), so this is inert.
  const sig = DRY_TEXT_SCALING && typeof ap.importance === 'number' && !ap.crisis ? 0.4 + 0.6 * Math.min(1, Math.max(0, ap.importance - 0.3) / 0.3) : 1;
  const rates = ap.world || ap.peer ? {} : { contact: Math.round(30 * sig) };
  for (const ch of CHANNELS) if (ch !== 'contact' && ap[ch] > 0) rates[ch] = Math.round(60 * sig * Math.min(1, ap[ch]));
  if (ap.crisis) rates.vulnerability = 60;
  return rates;
}

// Run the network forward to real time `toReal`, silently (no input).
// Returns { simMs, blackoutMs, stats } — stats from the last simulated second.
export function advanceTo(net, toReal, { chunkMs = 1000, maxSimMs = Infinity } = {}) {
  if (net.realTs == null) net.realTs = toReal;
  let gap = toReal - net.realTs;
  let blackoutMs = 0;
  if (gap > MAX_CATCHUP_REAL_MS) { blackoutMs = gap - MAX_CATCHUP_REAL_MS; net.realTs += blackoutMs; gap = MAX_CATCHUP_REAL_MS; }
  let simMs = Math.floor(Math.max(0, gap) / REAL_MS_PER_SIM_MS);
  simMs = Math.min(simMs, maxSimMs);
  setInput(net, {});
  let stats = null;
  for (let done = 0; done < simMs; done += chunkMs) stats = run(net, Math.min(chunkMs, simMs - done));
  net.realTs += simMs * REAL_MS_PER_SIM_MS;
  return { simMs, blackoutMs, stats };
}

// A message lands: stimulate, then read the state it leaves behind.
// Then the third factor: how this turned out vs. how the last message felt is a
// prediction error, which settles the tags the *previous* message left behind.
export function perceive(net, ap) {
  // What the last message tagged. Its outcome is this message, credited once:
  // the tags are used up here, so an older message can't be re-credited later.
  const tagsBefore = net.elig ? net.elig.slice() : null;
  if (net.elig) net.elig.fill(0);
  setInput(net, inputFor(ap));
  const during = run(net, STIM_MS);
  setInput(net, {});
  const after = run(net, READ_MS);
  net.realTs = (net.realTs ?? 0) + (STIM_MS + READ_MS) * REAL_MS_PER_SIM_MS;
  const r = readout(net, after);
  const felt = 2 * r.valence - 1;
  let dopamine = 0;
  if (tagsBefore && net.lastFelt != null) {
    dopamine = felt - net.lastFelt;
    // Threat pathways also hear what the words meant, but only when the words
    // are actually bad (bad news counts even if it didn't sting). Mild-but-kind
    // words ("jk love you") must not read as worse than they felt.
    const said = typeof ap.valence === 'number' ? ap.valence : felt;
    const dThreat = (said < 0 ? Math.min(felt, said) : felt) - net.lastFelt;
    reinforce(net, dopamine, tagsBefore, dThreat);
  }
  net.lastFelt = felt;
  return { during, after, readout: { ...r, dopamine: Math.round(dopamine * 1000) / 1000 } };
}

export function readout(net, stats) {
  const r = decode(net, stats);
  const round = (x) => Math.round(x * 1000) / 1000;
  return {
    valence: round(r.valence), tension: round(r.tension), warmth: round(r.warmth),
    playfulness: round(r.playfulness), irritation: round(r.irritation), arousal: round(r.arousal),
    dominant: CHANNELS[net.chanClusters.findIndex((c) => c[0] === r.dominant)] || `cluster ${r.dominant}`,
    focus: round(r.focus), eRate: round(stats.eRate),
    // The raw mixture (each channel-cluster's share of activity) and how good or
    // bad the brain's own decoder says each cluster's state is. The workspace
    // fuses these into one moment; the 6 numbers above are a projection of them.
    shares: sharesByName(net, stats.clusterRates), critic: criticByName(net),
  };
}

const nameOfCluster = (net, k) => CHANNELS[net.chanClusters.findIndex((c) => c[0] === k)] || `c${k}`;
export function sharesByName(net, rates) {
  const tot = rates.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(rates.map((v, k) => [nameOfCluster(net, k), Math.round((v / tot) * 1000) / 1000]));
}
export function criticByName(net) {
  return Object.fromEntries(Array.from(net.critic, (v, k) => [nameOfCluster(net, k), Math.round(v * 100) / 100]));
}

export function applyChemistry(net, chem = {}) {
  return modulate(net, chem);
}

// ── birth: wire candidates, keep the first viable one ──
// Checks: healthy resting activity, a decoder that tells hurt from warm, and a
// hurt state that holds on its own. (Deepening is checked when `thorough`.)
export function screen(net, { thorough = false } = {}) {
  const top = (s) => s.clusterRates.indexOf(Math.max(...s.clusterRates));
  const clusterOf = (ch) => net.chanClusters[CHANNELS.indexOf(ch)][0];
  const frozen = { plastic: false, homeostasis: false };
  const reasons = [];

  const rest = run(cloneNetwork(net), 2000, frozen);
  if (!(rest.eRate > 0.3 && rest.eRate < 20)) reasons.push(`resting rate ${rest.eRate.toFixed(1)}Hz`);

  const settle = (ch) => {
    const n = cloneNetwork(net);
    setInput(n, { [ch]: 60 }); run(n, 1000, frozen);
    setInput(n, {}); run(n, 2000, frozen);
    return run(n, 1000, frozen);
  };
  const hurt = settle('hostility'), warm = settle('warmth');
  const vh = decode(net, hurt).valence, vw = decode(net, warm).valence;
  if (!(vh < 0.4 && vw > 0.6)) reasons.push(`decoder can't separate (hurt ${vh.toFixed(2)}, warm ${vw.toFixed(2)})`);
  if (top(hurt) !== clusterOf('hostility')) reasons.push('hurt state did not hold');

  if (thorough) {
    const lift = (dwell, hz) => {
      const n = cloneNetwork(net);
      setInput(n, { hostility: 60 }); run(n, 1000);
      setInput(n, {}); run(n, dwell);
      setInput(n, { warmth: hz }); run(n, 500);
      setInput(n, {});
      return top(run(n, 2000)) === clusterOf('warmth');
    };
    if (!lift(1000, 20)) reasons.push('fresh mood too sticky');
    else if (lift(60000, 20)) reasons.push('moods do not deepen');
  }
  return { ok: reasons.length === 0, reasons };
}

export function birth({ opts = {}, seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], thorough = true, log = () => {} } = {}) {
  let fallback = null;
  for (const seed of seeds) {
    const net = createNetwork({ ...opts, seed });
    calibrateDecoder(net);
    run(net, 2000, { plastic: false, homeostasis: false });
    const basic = screen(net);
    if (!basic.ok) { log(`seed ${seed}: rejected (${basic.reasons.join('; ')})`); continue; }
    fallback ??= net;
    const full = thorough ? screen(net, { thorough: true }) : basic;
    if (full.ok) { log(`seed ${seed}: viable`); net.bornAt = Date.now(); return net; }
    log(`seed ${seed}: rejected (${full.reasons.join('; ')})`);
  }
  if (!fallback) throw new Error('no viable network found');
  log('no candidate passed every check; using the first healthy one');
  fallback.bornAt = Date.now();
  return fallback;
}

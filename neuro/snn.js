// ───────────────────────────────────────────────────────────────
//  THE SUBSTRATE
//  A clustered recurrent spiking network of Izhikevich neurons.
//  - E/I neurons (4:1), sparse random recurrent wiring. Excitatory
//    neurons are grouped into clusters with stronger internal wiring,
//    which is what lets the network fall into self-sustaining states
//    (attractors) and switch between them. Nothing here says "valence".
//  - Synapses: fast + slow (NMDA-like) excitation, fast inhibition.
//  - STDP on E->E and input->E synapses (pair-based, trace form).
//  - Homeostatic intrinsic plasticity: each neuron slowly tunes its own
//    excitability toward a target firing rate.
//  - Global neuromodulators scale gain, background drive and plasticity.
//  Inputs arrive as Poisson spike trains on named channels.
//  Everything is typed arrays + a seeded RNG: deterministic, serializable.
//  A model of a nervous system at hobbyist scale, not a nervous system.
// ───────────────────────────────────────────────────────────────

// Half-size network with the same in-degree. Same dynamics, ~2x faster. Used by tests.
export const SMALL = { nE: 800, nI: 200, pConn: 0.2, inTargets: 30 };

export const CHANNELS = ['warmth', 'hostility', 'vulnerability', 'win', 'humor', 'novelty', 'boring', 'contact'];

// Tuned by probing (neuro/tools/probe.mjs), not by theory. Notes on what each
// value fixed are in neuro/TUNING.md.
export const DEFAULTS = {
  nE: 1600, nI: 400, K: 8, seed: 1,
  pConn: 0.1,
  jPlus: 4.5,          // within-cluster E->E weight multiplier (bistability lives here)
  wEE: 0.12, wEI: 0.4, wIE: -1.2, wII: -0.7,
  slowFrac: 0.4,       // share of *input* excitation carried by the slow component
  nmdaAlpha: 0.3,      // recurrent slow synapses saturate: each spike opens alpha*(1-s)
  slowGain: 6,         // recurrent slow weight relative to fast
  tauFast: 5, tauSlow: 80, tauInh: 8,   // ms
  noiseE: 3.2, noiseI: 2.0,             // background noise current (sd)
  biasE: 1.0, biasI: 0.5,               // background drive
  inPerChannel: 50, inTargets: 60, inW: 1.0, inClusters: 1, inSpill: 0.25,
  wMax: 2.0, inWMax: 2.5,
  // Soft-bounded (multiplicative) STDP: LTP ~ (wMax - w), LTD ~ w. Stable, no runaway.
  stdpAplus: 0.0002, stdpAminus: 0.00025, tauStdp: 20,
  // Three-factor learning on the sensory (input->E) synapses (Izhikevich 2007):
  // STDP only *tags* a synapse (eligibility trace, decays over tauElig ms).
  // Weights change later, when a dopamine-like prediction error arrives
  // (reinforce()), in proportion to tag x error x the critic value of the
  // cluster the synapse feeds. Learns what his messages *turn out* to mean.
  threeFactor: true, tauElig: 5000, eligAplus: 1.0, eligAminus: 1.05, daEta: 0.005,
  eligPre: 0.3,        // tag from presynaptic activity alone, so a numbed pathway can re-sensitize
  // Synaptic scaling (Turrigiano): every scaleEvery ms, each E neuron nudges its
  // total incoming E->E weight back toward its birth total. Learning redistributes
  // strength between inputs; it can't just inflate everything.
  scaleEvery: 500, scaleRate: 0.2,
  // Rate-driven scaling: a neuron above its set point slowly shrinks its birth
  // total (max fractional change per scaling event). The slow brake on rumination.
  scaleHomeo: 0.0001,
  targetRate: 5,       // Hz, homeostatic set point
  // Temperament (designed): per-channel-cluster set points. Clusters with higher
  // targets get pushed up harder by homeostasis while silent, so when a mood
  // erodes they tend to win next. This is the personality's resting pull.
  temperament: { warmth: 8, hostility: 1.5, vulnerability: 1.5, win: 5, humor: 9, novelty: 5, boring: 1.5, contact: 7 },
  tauRate: 20000,      // ms, firing-rate estimate window
  etaHomeo: 2e-7,      // homeostatic bias learning rate (per ms per Hz of error)
  // Mood stickiness: divides both homeostatic rates (etaHomeo, scaleHomeo).
  // 1 = a bad hour lingers ~14-16 real hours. Higher = moods last longer.
  stickiness: 1,
  biasMin: -12, biasMax: 6,
};

// ── RNG (mulberry32), state kept in the network so runs are reproducible ──
function rngFrom(net) {
  let s = net.rng >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, save: () => { net.rng = s; } };
}

export function createNetwork(opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const { nE, nI, K } = p;
  const N = nE + nI;
  const net = { p, N, nE, nI, K, t: 0, rng: p.seed >>> 0 || 1 };
  const R = rngFrom(net);
  const r = R.next;

  // Neuron parameters (Izhikevich 2003, with heterogeneity).
  net.a = new Float32Array(N); net.b = new Float32Array(N); net.c = new Float32Array(N); net.d = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = r();
    if (i < nE) { net.a[i] = 0.02; net.b[i] = 0.2; net.c[i] = -65 + 15 * x * x; net.d[i] = 8 - 6 * x * x; }
    else { net.a[i] = 0.02 + 0.08 * x; net.b[i] = 0.25 - 0.05 * x; net.c[i] = -65; net.d[i] = 2; }
  }
  net.v = new Float32Array(N).fill(-65);
  net.u = new Float32Array(N);
  for (let i = 0; i < N; i++) net.u[i] = net.b[i] * net.v[i];
  net.bias = new Float32Array(N);
  for (let i = 0; i < N; i++) net.bias[i] = i < nE ? p.biasE : p.biasI;
  net.rate = new Float32Array(N).fill(p.targetRate);   // running firing-rate estimate (Hz)

  // Clusters: contiguous blocks of E neurons.
  net.cluster = new Int8Array(nE);
  const per = Math.floor(nE / K);
  for (let i = 0; i < nE; i++) net.cluster[i] = Math.min(K - 1, Math.floor(i / per));

  // Recurrent synapses in CSR form by presynaptic neuron.
  const pre = [], post = [], w = [];
  const jMinus = (K - p.jPlus) / (K - 1); // keeps total E input roughly balanced
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j || r() >= p.pConn) continue;
      let wt;
      if (i < nE && j < nE) wt = p.wEE * (net.cluster[i] === net.cluster[j] ? p.jPlus : jMinus) * (0.5 + r());
      else if (i < nE) wt = p.wEI * (0.5 + r());
      else if (j < nE) wt = p.wIE * (0.5 + r());
      else wt = p.wII * (0.5 + r());
      pre.push(i); post.push(j); w.push(wt);
    }
  }
  const S = pre.length;
  net.synPre = Int32Array.from(pre);
  net.synPost = Int32Array.from(post);
  net.w = Float32Array.from(w);
  net.outStart = new Int32Array(N + 1);
  for (let s = 0; s < S; s++) net.outStart[pre[s] + 1]++;
  for (let i = 0; i < N; i++) net.outStart[i + 1] += net.outStart[i];
  // Incoming E->E synapse lists per E neuron (for LTP when the post neuron fires).
  const inc = Array.from({ length: nE }, () => []);
  for (let s = 0; s < S; s++) if (pre[s] < nE && post[s] < nE) inc[post[s]].push(s);
  [net.inStart, net.inSyn] = flatten(inc);
  net.inTarget = new Float32Array(nE);   // birth total of incoming E->E weight (synaptic scaling set point)
  for (let i = 0; i < nE; i++) for (const s of inc[i]) net.inTarget[i] += w[s];
  net.inTarget0 = net.inTarget.slice();  // bounds for rate-driven scaling

  // Input neurons: CHANNELS x inPerChannel Poisson sources. Each channel mostly
  // targets a couple of randomly chosen clusters (its "anatomy"), with spillover.
  const nIn = CHANNELS.length * p.inPerChannel;
  net.nIn = nIn;
  // Each channel gets its own primary cluster (shuffled) plus random secondaries.
  const order = Array.from({ length: K }, (_, k) => k);
  for (let k = K - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
  net.chanClusters = CHANNELS.map((_, ch) => {
    const cs = new Set([order[ch % K]]);
    while (cs.size < Math.min(p.inClusters, K)) cs.add(Math.floor(r() * K));
    return [...cs];
  });
  // Per-neuron homeostatic set point from temperament (via each cluster's channel).
  net.target = new Float32Array(N).fill(p.targetRate);
  CHANNELS.forEach((name, ch) => {
    const k = net.chanClusters[ch][0], tr = p.temperament?.[name];
    if (tr == null) return;
    for (let i = k * per; i < (k === K - 1 ? nE : (k + 1) * per); i++) net.target[i] = tr;
  });

  const iPre = [], iPost = [], iW = [];
  for (let c = 0; c < CHANNELS.length; c++) {
    const home = net.chanClusters[c];
    for (let k = 0; k < p.inPerChannel; k++) {
      const src = c * p.inPerChannel + k;
      for (let m = 0; m < p.inTargets; m++) {
        let tgt;
        if (r() < p.inSpill) tgt = Math.floor(r() * nE);
        else { const cl = home[Math.floor(r() * home.length)]; tgt = cl * per + Math.floor(r() * per); }
        iPre.push(src); iPost.push(tgt); iW.push(p.inW * (0.5 + r()));
      }
    }
  }
  net.inPre = Int32Array.from(iPre);
  net.inPost = Int32Array.from(iPost);
  net.inW = Float32Array.from(iW);
  net.inOutStart = new Int32Array(nIn + 1);
  for (const s of iPre) net.inOutStart[s + 1]++;
  for (let i = 0; i < nIn; i++) net.inOutStart[i + 1] += net.inOutStart[i];
  const incIn = Array.from({ length: nE }, () => []);
  for (let s = 0; s < iPre.length; s++) incIn[iPost[s]].push(s);
  [net.inInStart, net.inInSyn] = flatten(incIn);

  // Dynamic state.
  net.gFast = new Float32Array(N); net.gSlow = new Float32Array(N); net.gInh = new Float32Array(N);
  net.sN = new Float32Array(nE);       // per-neuron NMDA gating (saturates at 1)
  net.xPre = new Float32Array(N);      // STDP presynaptic traces (E only used)
  net.yPost = new Float32Array(nE);    // STDP postsynaptic traces
  net.xIn = new Float32Array(nIn);     // input traces
  net.elig = new Float32Array(net.inW.length); // eligibility tags on input synapses
  net.critic = new Float32Array(K);    // valence each cluster stands for (set by calibrateDecoder)
  net.inRate = new Float32Array(CHANNELS.length); // current Poisson rate per channel (Hz)

  // Neuromodulators (global chemistry). Set from drives by modulate().
  net.mod = { gain: 1, drive: 1, plasticity: 1 };
  R.save();
  return net;
}

function flatten(lists) {
  const start = new Int32Array(lists.length + 1);
  for (let i = 0; i < lists.length; i++) start[i + 1] = start[i] + lists[i].length;
  const flat = new Int32Array(start[lists.length]);
  for (let i = 0; i < lists.length; i++) flat.set(lists[i], start[i]);
  return [start, flat];
}

// ── neuromodulation: drives are the chemistry the network runs in ──
// connection (social need) is an inverted U: acute loneliness raises gain
// (vigilance, more reactive); sustained isolation (need past 0.7, roughly a
// day alone) brings withdrawal, lowering gain AND background drive, so the
// network goes quiet and flat instead of running hot.
// energy: body clock/rest, low energy lowers gain and drive (sleep).
// novelty + play: raise plasticity (dopamine/NE-like learning signals).
export function modulate(net, { connection = 0.5, energy = 0.65, novelty = 0.3, play = 0.4, learning = 1 } = {}) {
  const vigilance = Math.min(connection, 0.7);
  const withdrawal = Math.max(0, (connection - 0.7) / 0.3);
  net.mod.gain = (0.85 + 0.3 * vigilance) * (1 - 0.3 * withdrawal) * (0.55 + 0.45 * energy / 0.65);
  net.mod.drive = (0.35 + 0.65 * Math.min(1, energy / 0.65)) * (1 - 0.35 * withdrawal);
  net.mod.plasticity = learning * (0.4 + 0.8 * novelty + 0.4 * play);
  return net.mod;
}

// Set the input firing rate for channels, e.g. { hostility: 40 }.
export function setInput(net, rates = {}) {
  net.inRate.fill(0);
  for (const [name, hz] of Object.entries(rates)) {
    const c = CHANNELS.indexOf(name);
    if (c >= 0) net.inRate[c] = Math.max(0, hz);
  }
}

// Advance the network by `ms` milliseconds (dt = 1 ms). Returns spike stats.
export function run(net, ms, { plastic = true, homeostasis = true, record = false } = {}) {
  const { p, N, nE, K } = net;
  const R = rngFrom(net);
  const r = R.next;
  const dF = Math.exp(-1 / p.tauFast), dS = Math.exp(-1 / p.tauSlow), dI = Math.exp(-1 / p.tauInh), dT = Math.exp(-1 / p.tauStdp);
  const rateDecay = 1 / p.tauRate;
  const { v, u, a, b, c, d, bias, rate, target, gFast, gSlow, gInh, sN, xPre, yPost, xIn, w, synPost, synPre, outStart, inStart, inSyn,
    inW, inPost, inPre, inOutStart, inInStart, inInSyn, inRate, cluster } = net;
  const gain = net.mod.gain, drive = net.mod.drive;
  const Ap = plastic ? p.stdpAplus * net.mod.plasticity : 0;
  const Am = plastic ? p.stdpAminus * net.mod.plasticity : 0;
  const sf = p.slowFrac, ff = 1 - sf;
  const stick = p.stickiness || 1;
  const etaH = p.etaHomeo / stick;
  const tf = !!p.threeFactor && !!net.elig;
  const elig = net.elig, eAp = p.eligAplus, eAm = p.eligAminus, eP = p.eligPre ?? 0;
  const dE10 = Math.exp(-10 / (p.tauElig || 5000));
  const per = p.inPerChannel;
  const counts = new Float64Array(K);
  let eSpikes = 0, iSpikes = 0;
  const trace = record ? [] : null;
  const fired = new Int32Array(N);

  for (let t = 0; t < ms; t++) {
    // Poisson input spikes.
    for (let ch = 0; ch < inRate.length; ch++) {
      const pr = inRate[ch] / 1000;
      if (pr <= 0) continue;
      for (let k = ch * per, end = k + per; k < end; k++) {
        if (r() >= pr) continue;
        for (let s = inOutStart[k]; s < inOutStart[k + 1]; s++) {
          const tgt = inPost[s];
          gFast[tgt] += inW[s] * ff; gSlow[tgt] += inW[s] * sf;
          if (Am > 0) { if (tf) elig[s] += eP - eAm * yPost[tgt]; else inW[s] -= Am * yPost[tgt] * inW[s]; }
        }
        xIn[k] += 1;
      }
    }

    // Neuron dynamics.
    let nf = 0;
    for (let i = 0; i < N; i++) {
      const isE = i < nE;
      const noise = (r() + r() + r() + r() - 2) * 1.732 * (isE ? p.noiseE : p.noiseI);
      const I = gain * (gFast[i] + gSlow[i]) + gInh[i] + bias[i] * drive + noise;
      let vi = v[i], ui = u[i];
      vi += 0.5 * (0.04 * vi * vi + 5 * vi + 140 - ui + I);
      vi += 0.5 * (0.04 * vi * vi + 5 * vi + 140 - ui + I);
      ui += a[i] * (b[i] * vi - ui);
      if (vi >= 30) { vi = c[i]; ui += d[i]; fired[nf++] = i; rate[i] += (1000 - rate[i]) * rateDecay; }
      else rate[i] -= rate[i] * rateDecay;
      v[i] = vi; u[i] = ui;
      if (homeostasis && isE) {
        const nb = bias[i] + etaH * (target[i] - rate[i]);
        bias[i] = nb < p.biasMin ? p.biasMin : nb > p.biasMax ? p.biasMax : nb;
      }
    }

    // Synaptic decay, then deliver this step's spikes.
    for (let i = 0; i < N; i++) { gFast[i] *= dF; gSlow[i] *= dS; gInh[i] *= dI; }
    for (let i = 0; i < nE; i++) sN[i] *= dS;
    for (let f = 0; f < nf; f++) {
      const i = fired[f];
      if (i < nE) {
        eSpikes++; counts[cluster[i]]++;
        // Saturating slow synapse: postsynaptic slow current = sum_j w_ij * s_j,
        // and s_j decays with tauSlow, so adding w * delta_s keeps it exact.
        const ds = p.nmdaAlpha * (1 - sN[i]);
        sN[i] += ds;
        const slowK = p.slowGain * ds;
        for (let s = outStart[i]; s < outStart[i + 1]; s++) {
          const tgt = synPost[s], ws = w[s];
          gFast[tgt] += ws; gSlow[tgt] += ws * slowK;
          // pre-after-post: depress
          if (Am > 0 && tgt < nE) w[s] = ws - Am * yPost[tgt] * ws;
        }
        // post spike: potentiate incoming E->E and input->E by presynaptic traces
        if (Ap > 0) {
          for (let q = inStart[i]; q < inStart[i + 1]; q++) {
            const s = inSyn[q];
            w[s] += Ap * xPre[synPre[s]] * (p.wMax - w[s]);
          }
          for (let q = inInStart[i]; q < inInStart[i + 1]; q++) {
            const s = inInSyn[q];
            if (tf) elig[s] += eAp * xIn[inPre[s]];
            else inW[s] += Ap * xIn[inPre[s]] * (p.inWMax - inW[s]);
          }
        }
        xPre[i] += 1; yPost[i] += 1;
      } else {
        iSpikes++;
        for (let s = outStart[i]; s < outStart[i + 1]; s++) gInh[synPost[s]] += w[s];
      }
    }
    for (let i = 0; i < nE; i++) { xPre[i] *= dT; yPost[i] *= dT; }
    for (let k = 0; k < xIn.length; k++) xIn[k] *= dT;
    if (tf && t % 10 === 9) for (let s = 0; s < elig.length; s++) elig[s] *= dE10;

    // Synaptic scaling.
    if ((Ap > 0 || homeostasis) && (net.t + t + 1) % p.scaleEvery === 0) {
      const { inTarget } = net;
      const hs = homeostasis ? p.scaleHomeo / stick : 0;
      for (let i = 0; i < nE; i++) {
        if (hs) {
          const err = (target[i] - rate[i]) / Math.max(target[i], 1);
          const nt = inTarget[i] * (1 + Math.max(-hs, Math.min(hs, err * hs)));
          const t0 = net.inTarget0[i];
          // Can shrink an overactive neuron's input, and recover it back to birth
          // level, but never inflate a silent neuron past birth (no hot rebounds).
          inTarget[i] = nt < 0.3 * t0 ? 0.3 * t0 : nt > t0 ? t0 : nt;
        }
        let sum = 0;
        for (let q = inStart[i]; q < inStart[i + 1]; q++) sum += w[inSyn[q]];
        if (sum <= 0) continue;
        const f = 1 + p.scaleRate * (inTarget[i] / sum - 1);
        for (let q = inStart[i]; q < inStart[i + 1]; q++) w[inSyn[q]] *= f;
      }
    }

    if (record && t % 10 === 0) trace.push(nf);
  }
  net.t += ms;
  R.save();
  const sec = ms / 1000, perC = Math.floor(nE / K);
  return {
    clusterRates: Array.from(counts, (n, k) => n / ((k === K - 1 ? nE - perC * (K - 1) : perC) * sec)),
    eRate: eSpikes / (nE * sec),
    iRate: iSpikes / (net.nI * sec),
    trace,
  };
}

// ── decoder: population firing -> a small readout vector ──
// Readout weights are fit once, at birth, on a frozen copy of the network by
// probing it with each input channel (ridge regression from cluster rates).
// After that the network keeps changing; the decoder just reads it.

export const READOUTS = {
  valence:     { warmth: 0.8, hostility: -1, vulnerability: -0.7, win: 1, humor: 0.6, novelty: 0.2, boring: -0.4, contact: 0.3 },
  tension:     { warmth: -0.2, hostility: 0.9, vulnerability: 1, win: -0.2, humor: -0.3, novelty: 0.1, boring: 0, contact: 0 },
  warmth:      { warmth: 1, hostility: -0.6, vulnerability: 0.5, win: 0.3, humor: 0.2, novelty: 0, boring: -0.3, contact: 0.5 },
  playfulness: { warmth: 0.2, hostility: -0.3, vulnerability: -0.6, win: 0.6, humor: 1, novelty: 0.5, boring: -0.5, contact: 0.2 },
  irritation:  { warmth: -0.4, hostility: 1, vulnerability: -0.2, win: -0.3, humor: -0.2, novelty: -0.1, boring: 0.6, contact: 0 },
};

export function cloneNetwork(net) {
  const out = { ...net, p: { ...net.p }, mod: { ...net.mod } };
  for (const [k, val] of Object.entries(net)) {
    if (ArrayBuffer.isView(val)) out[k] = val.slice();
  }
  return out;
}

export function calibrateDecoder(net, { onMs = 800, offMs = 1200, hz = 60, reps = 2 } = {}) {
  const probe = cloneNetwork(net);
  const X = [], Y = {};
  for (const name of Object.keys(READOUTS)) Y[name] = [];
  const addSample = (rates, targets) => {
    X.push([...shares(rates), 1]);
    for (const name of Object.keys(READOUTS)) Y[name].push(targets[name]);
  };
  const frozen = { plastic: false, homeostasis: false };
  setInput(probe, {});
  run(probe, 1000, frozen);
  for (let rep = 0; rep < reps; rep++) {
    for (const ch of CHANNELS) {
      const target = Object.fromEntries(Object.entries(READOUTS).map(([n, map]) => [n, map[ch]]));
      setInput(probe, { [ch]: hz });
      run(probe, onMs / 2, frozen);
      addSample(run(probe, onMs / 2, frozen).clusterRates, target);   // while it's happening
      setInput(probe, {});
      run(probe, offMs / 2, frozen);
      addSample(run(probe, offMs / 2, frozen).clusterRates, target);  // the state it leaves behind
    }
  }
  const decoder = { weights: {}, K: net.K };
  for (const name of Object.keys(READOUTS)) decoder.weights[name] = ridge(X, Y[name], 0.05);
  net.decoder = decoder;
  // The critic: how good or bad each cluster's state is, from the valence
  // readout (normalized to -1..1). Used to sign the dopamine update.
  const vw = decoder.weights.valence.slice(0, net.K);
  const m = Math.max(...vw.map(Math.abs)) || 1;
  net.critic = Float32Array.from(vw, (x) => x / m);
  return decoder;
}

// ── the third factor: a dopamine-like prediction error ──
// dFelt = felt valence now - felt valence after the previous message (-1..1).
// Every tagged sensory synapse moves by eta * tag * d * critic[target cluster]:
// a roast that felt bad but turned out fine weakens roast->hurt; warmth that
// felt good but was followed by coldness weakens warmth->good.
// Threat pathways (critic < 0) use dThreat instead, which also counts what the
// words meant (bad news counts even if it didn't sting), so tolerance built
// by banter can be undone by real hostility. Warm pathways learn from feeling
// alone. Tags from *before* the outcome are used (snapshot before stimulating).
export function reinforce(net, dFelt, tags = net.elig, dThreat = dFelt) {
  const { p, inW, inPost, cluster, critic } = net;
  const eta = p.daEta * net.mod.plasticity;
  if (!eta || (!dFelt && !dThreat)) return 0;
  let moved = 0;
  for (let s = 0; s < inW.length; s++) {
    const e = tags[s];
    if (!e) continue;
    const c = critic[cluster[inPost[s]]];
    const dw = eta * e * (c < 0 ? dThreat : dFelt) * c;
    const nw = inW[s] + dw;
    inW[s] = nw < 0 ? 0 : nw > p.inWMax ? p.inWMax : nw;
    moved += Math.abs(dw);
  }
  return moved;
}

function ridge(X, y, lambda) {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += X[r][i] * X[r][j];
      A[i][n] += X[r][i] * y[r];
    }
  }
  for (let i = 0; i < n - 1; i++) A[i][i] += lambda; // don't penalize bias
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const div = A[col][col] || 1e-9;
    for (let j = col; j <= n; j++) A[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f) for (let j = col; j <= n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return Array.from(A, (row) => row[n]);
}

// The decoder reads the *pattern* (each cluster's share of activity), not raw
// intensity: the same basin fires hot while driven and cooler once it holds on
// its own, and both mean the same mood. Intensity is reported as arousal.
function shares(rates) {
  const total = rates.reduce((s, v) => s + v, 0);
  return total > 0 ? rates.map((v) => v / total) : rates.map(() => 1 / rates.length);
}

// Cluster rates -> readout vector in 0..1 (0.5 = neutral), plus arousal.
export function decode(net, stats) {
  const out = {};
  const x = [...shares(stats.clusterRates), 1];
  for (const [name, wts] of Object.entries(net.decoder.weights)) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += wts[i] * x[i];
    out[name] = 1 / (1 + Math.exp(-2.5 * s));
  }
  out.arousal = 1 - Math.exp(-stats.eRate / 4);
  // Which cluster dominates, and by how much (a sign of being "in" a state).
  const cr = stats.clusterRates;
  let top = 0;
  for (let k = 1; k < cr.length; k++) if (cr[k] > cr[top]) top = k;
  const mean = cr.reduce((s, v) => s + v, 0) / cr.length;
  out.dominant = top;
  out.focus = mean > 0 ? Math.min(1, (cr[top] - mean) / (cr[top] + 1e-9)) : 0;
  return out;
}

// ── serialization (state lives on disk between runs) ──
export function serialize(net) {
  const arrays = {};
  const plain = {};
  for (const [k, val] of Object.entries(net)) {
    if (ArrayBuffer.isView(val)) arrays[k] = { type: val.constructor.name, data: Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString('base64') };
    else plain[k] = val;
  }
  return JSON.stringify({ plain, arrays });
}

const TYPES = { Float32Array, Int32Array, Int8Array, Float64Array };
export function deserialize(text) {
  const { plain, arrays } = JSON.parse(text);
  const net = { ...plain };
  for (const [k, { type, data }] of Object.entries(arrays)) {
    const buf = Buffer.from(data, 'base64');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    net[k] = new TYPES[type](ab);
  }
  return net;
}

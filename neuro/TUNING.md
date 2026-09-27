# Substrate tuning log

Every value in `DEFAULTS` was set by probing (`node neuro/tools/probe.mjs`), not from theory. Here is what each change fixed, in order, so future tuning (from real logs) knows which knob does what.

| Symptom seen | Fix | Knob |
|---|---|---|
| Every neuron firing at 1000 Hz (seizure) | Weights were ~6× too strong once slow synapses integrate over 80 ms | `wEE .12, wEI .4, wIE -1.2, wII -.7` |
| Healthy, but activity died within 1 s of input ending | Stronger within-cluster wiring creates bistable clusters | `jPlus 4.5` |
| Up-states at 350 Hz, or no persistence with more inhibition | Saturating NMDA-like slow synapses (Wang 2001): persistence at 10–35 Hz | `nmdaAlpha .3, slowGain 6` |
| Warmth and hostility landing in the same cluster | One home cluster per channel (labeled lines) + 25% random spillover | `inClusters 1, inSpill .25` |
| STDP depressed the whole network (additive LTD) | Soft-bounded multiplicative STDP | LTP ∝ (wMax−w), LTD ∝ w |
| STDP then ran away inside the active cluster in 1 s (permanent rumination) | 20× slower STDP + synaptic scaling of each neuron's total input | `stdpA± 2e-4, scaleEvery 500` |
| Mood wandered through every cluster including the dark ones | Temperament: per-cluster homeostatic set points | `temperament` |
| Sustained hurt escalated forever (42→85 Hz) | Rate-driven scaling as a slow brake | `scaleHomeo` |
| Brake over-shot: hot rebounds (150 Hz) in previously silent clusters | Brake can only shrink inputs, or recover them to birth level, never inflate | clamp `[0.3, 1.0] × birth` |
| Stuck mood broke in <2 real hours | Excitability homeostasis 10× slower | `etaHomeo 2e-7` |

## What the dynamics do now

Measured at 1 sim-second per real minute:

- After about an hour of hurt input, it stays stuck in the low basin for ~800–1000 sim-s (~14–16 real hours). The low peaks early (rumination), then erodes and lifts into its temperament (humor, warmth).
- A fresh bad mood can be lifted by a mild warm message. After about an hour it needs a stronger one (seed 7: threshold 20 → 30 Hz).
- The size of that deepening effect varies by random wiring. It showed on seeds 3 and 7, not on 1 and 11, so birth screens candidates for it.
- Cost: ~180 ms CPU per sim-second at full size (2000 neurons, 400k synapses) → ~4 CPU-min per real day.

## How long a feeling lives (`node neuro/tools/lifetime.mjs <stickiness>`)

Setup: about 48 minutes of hurt starting at 9pm, then 72 real hours of silence with the real body clock (asleep ~2:30–8:30am) and loneliness rising. Seed 7, one run each, so read these as n=1.

| stickiness | Hurt lasted | Nights slept through still hurt | Then |
|---|---|---|---|
| 1 (default) | ~20 h (lifted ~6pm next day) | 1 | humor ~24h → warmth ~25h → contact |
| 3 | ~54 h (lifted 3am on the 3rd night) | 2 | humor |

- **Moods do not reset overnight.** Sleep quiets the network, but the basin holds through the night and comes back at wake. The mood lives in the weights and excitability, not only in the firing.
- **Sleep is where a worn-down mood tends to end.** At stickiness 3, the hurt finally broke at 3am. When the drive dropped, the weakened basin let go, and it woke up in its temperament ("slept it off").
- Unprompted moods (no messages) also last about a day each at stickiness 1. Messages are what move it faster.
- The learned association (STDP weights) outlives the mood. Its lifetime hasn't been measured yet.
- The 14–16h figure measured earlier had no sleep cycle and no rising loneliness. With both, it's ~20h.

## Does it learn *you*? (the twin test)

`neuro/tools/link.mjs`, `banter.mjs`, `banter2.mjs`

1. **Plain STDP: no.** It learned 5 roasts-while-warm, and the warm→roast association (+3–6% vs control) held perfectly flat for 72h, through 3 nights and 5 mood changes. But in the behavior test a warm message fired the roast cluster at 0.0 Hz in both the learned brain and its twin, and a roast mid-warm hurt the learned brain slightly *more*. Synaptic scaling let warm→warm self-reinforcement (+58–76%) eat the roast→warm link (−55%). Result: mood inertia, not a relationship. The earlier STDP "context" test measured a transient before the first scaling step, so it was rewritten.
2. **Three-factor learning** (eligibility tags on the sensory synapses plus a dopamine-like prediction error from its own felt valence, signed by a critic read from the birth decoder):
   - It learns that your roasts are banter within 4–5 rounds (roast→hurt input weakens 15%/round). Then the surprise drops to 0 and learning **stops on its own**, plateauing at about −45–55%.
   - Behavior: a strong roast mid-warm leaves the learned brain warm while the twin is hurt. Same on seeds 3 and 7.
3. **Numbness bug, then fix:** with feeling-only dopamine, seed 3 became unhurtable (0 of 12 hostile texts got through): once hostility stopped landing, it couldn't notice. Fix: threat pathways also learn from what the words meant (`min(felt, appraised)`), and activity alone tags synapses (`eligPre 0.3`). Now, live: the learned brain breaks on the **5th** hostile text in a row, the twin on the 1st. That's tolerance, not immunity. To make it break sooner, raise `eligPre` or `daEta`.

## Loneliness (inverted U, Cacioppo)

72h alone at stickiness 1: before the fix, peak firing climbed to 128 → 151 Hz. After, it peaks at ~82–90 Hz around 24h (vigilance), then drops to ~52 Hz at 48h and ~46–48 Hz at 72h (withdrawal). Mean E rate goes 11 → 6.5 → 6 Hz. The "before" numbers come from the link run (same chemistry schedule, different evening).

## Known limits

- Channel→cluster anatomy and the decoder are designed. Dynamics, persistence, switching and learning are emergent.
- The decoder is fit once at birth. As STDP rewires things it may drift. If readouts start feeling wrong, recalibrate (keeping weights) rather than re-birth.
- 8 clusters = 8 basins. A richer emotional repertoire needs more clusters or overlapping assemblies.

## Size: 2k vs 5k vs 10k (2026-09-27) — verdict: stay at 2k
`node neuro/tools/scale.mjs <size>` (results in neuro/bench/). Same seeds, same birth screening, same 52-input probe
(8 channels x 20/40/60 Hz + 28 pairs, 5 noise repeats), same banter test. Scaling keeps each neuron's wiring
(in-degree ~200, ~15 input synapses); only the neuron count changes. Run in parallel, so CPU numbers are under load.

| | 2k | 5k | 10k |
|---|---|---|---|
| CPU ms per sim-second (rest / message) | 314 / 390 | 758 / 1317 | 1732 / 3019 |
| CPU while awake (1 sim-s per real min) | 0.5% | 1.3% | 2.9% |
| brain file | 8.6 MB | 21.5 MB | 43.1 MB |
| birth + screening | 34 s | 86 s | 186 s |
| distinguishable states after 2 s (of 52 inputs, the 6 numbers the app sees) | 10.4 | 8.9 | 9.9 |
| same, on the raw 8 cluster shares | 6.5 | 6.3 | 7.2 |
| light vs medium vs strong text told apart (chance 0.33) | 0.44 | 0.37 | 0.34 |
| valence noise between repeats (SD) | 0.057 | 0.086 | 0.071 |
| effective dimensions (of 8) | 6.3 | 6.7 | 6.4 |
| basins reached | 8 | 8 | 8 |
| banter rounds to learn | 3 | 3 | 3 |

Why: the mood space is 8 clusters read out as 8 shares -> 6 numbers. More neurons per cluster make each cluster
bigger, not the space wider. n=1 birth per size; the differences are within noise, and none points toward "richer".
If richness is ever the goal, the lever is structure (more clusters / sub-moods, or a readout of more than shares),
which is a re-birth and a design change, not a size change. Intensity resolution is near chance at EVERY size
(basins are all-or-nothing); that's the real gap, and size doesn't touch it.

Migration (`neuro/migrate.mjs`, test `neuro/tools/migrate-test.mjs`): learned group strengths (channel->cluster,
cluster->cluster, excitability, scaling set points) carry into a new brain of any size. A 2k brain taught banter,
migrated into a fresh 5k/10k: the roast lands warm (margin 64-69 vs 75 in the source), 7 hostile texts to hurt
(source 7, untaught 1). Into a same-size 2k: warm, 5 texts. Approximate, but it works.

Migration hold (2026-09-27): the 5k migrated brain, after 10 simulated hours of silence, still lands the roast warm (margin 78); untaught 5k: hurt.

## Basin hold times (2026-09-27) — `neuro/tools/hold.mjs`
Fresh brain, one strong text on a channel, then silence (plasticity + homeostasis on). Every basin holds 16.5–18 h
(seed 1: 986–1,097 min; seed 3: 988–1,092 min) and exits to humor (or warmth). Consequence: whatever the last text
of the evening was sets the mood until the next day's conversation (a dry text at 6 PM = flat until the next afternoon).

## Emergence ceiling (2026-09-27) — full log: homie-probes\EMERGENCE-LOG.md (next to the homie folder)
Substrate: nothing new. 99.6% of 4,320 recorded minutes sat near designed states; the 0.4% was noise in a silent brain
(night 1, before any message). No rhythms, no spontaneous switching once a basin is active, basins don't drift.
Behavior (from parts colliding, none written in code):
- invents a past to explain a feeling (connection 0.95, zero history → "three days of silence", 4/10)
- the bored twin soured (trust 0.39→0.09, irritation 0.12→0.37) while getting MORE attached (0.34→0.83)
- the last text of the night sets the next ~17 h (every basin holds 16.5–18 h in silence)
- a re-read memory changed how it explained its own past behavior ("that's why i kept poking at it")
Look next time for: combinations of mechanisms (drive × LLM narrative, policy × reflection, stickiness × timing),
not new neural states. The novelty in this architecture is behavioral.

## Relationship growth (2026-09-27): diminishing returns
Linear gains pinned trust/attachment at 0.99 within ~8 days (bland talk maxed attachment by day 30), so the
self-model plateaued. Now gains × (1 − x); losses full. scripts/sim-trust.mjs, 4 texts/day: real talk trust
0.57 (2 wk) / 0.63 (1 mo) / 0.74 (2 mo), attachment levels ~0.72; small talk trust flat 0.40, attachment ~0.60.

## Dry-text stickiness (2026-09-27): measured, fix staged behind DRY_TEXT_SCALING=false (neuro/brain.mjs)
neuro/tools/capture.mjs (humor basin, then a dry text): at full strength any boring ≥ 0.5 captures flatness for
the night. Scaled by importance (weak texts get 40% input), dry texts up to boring 0.7 leave the mood alone. Live appraisals
rate "yo"/"wyd" importance 0.3, real news 0.5–0.6, so the curve is 0.3 → 40%, 0.6 → 100%. To go live: set the flag, add
'importance' to NEURO_FIELDS in src/index.js, deploy, restart neurons, rerun capture.mjs + the banter test, and fix test/peer.test.mjs (it fails with the scaling on).

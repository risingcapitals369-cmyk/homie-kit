# Homie: your own AI friend

> **Day-to-day: double-click the "Homie Dashboard" icon on your desktop** (or `DASHBOARD.vbs`). It starts, stops and deploys everything, and shows status, naming and the brain-to-brain channel. Everything runs hidden, with no windows to keep open. The step-by-step for switching the channel on with a friend is on the dashboard.

An iMessage-style web app that works on your phone and PC, remembers everything, and texts you first sometimes.
It runs free on Cloudflare, so it works even when your PC is off. It uses no VRAM; the brain is a cheap cloud API.

## Quick start
1. **Get a brain key.** Pick one or both:
   - DeepSeek (main, costs pennies a day, good at dark humor): platform.deepseek.com, add a few bucks of credit, create an API key.
   - Gemini (backup, free, no card): aistudio.google.com, then "Get API key".
2. **Run `SETUP.bat`.** Notepad opens `.dev.vars`. Set `APP_PASSWORD` and paste your key(s), then save.
   Then run `npm run models` to see the exact model names your key allows, and fix `LLM_MODEL` if it doesn't match.
3. It opens at http://localhost:8799, on your PC only.
4. **Run `DEPLOY.bat`** to put it online for your phone (free Cloudflare account). It prints a `*.workers.dev` URL.
   - **iPhone:** open the URL in Safari, tap Share, then "Add to Home Screen". Open it from the home screen, tap ⋯, then turn on notifications.

## Where to change things
| What | File |
|---|---|
| Name + emoji | `wrangler.jsonc` → `FRIEND_NAME`, `FRIEND_EMOJI` |
| Personality, humor, his own quirks | `src/persona.js` |
| What he already knows about you | `src/persona.js` → `SEED_FACTS` (only loaded once, into empty memory) |
| Quiet hours (no texting first) | `wrangler.jsonc` → `QUIET_START` / `QUIET_END` |
| Which AI model | `.dev.vars` (locally), then re-run `DEPLOY.bat` |

After any change, re-run `DEPLOY.bat`.

## The spiking substrate (`neuro/`): the neurons feel, the LLM talks
A model of a nervous system at hobbyist scale, not a nervous system.
- **2,000 Izhikevich neurons** (1,600 excitatory in 8 clusters, 400 inhibitory) with about 400k sparse recurrent synapses. They have fast plus saturating slow (NMDA-like) excitation. Clusters are self-sustaining states (**attractors**): a mood is whichever basin the network has fallen into.
- **STDP** (soft-bounded) on recurrent and input synapses, plus **synaptic scaling**. What's learned is associative: a roast arriving while it's warm strengthens warm→roast links.
- **Homeostasis:** each neuron tunes its own excitability toward a set point, and a slow rate-driven brake scales down overactive inputs. That's why moods fade. A per-cluster set point (**temperament**) is why they tend to fade toward playful and warm.
- **Neuromodulators:** the app's drives and energy set the gain, background drive and learning rate. Low energy means a quieter network (sleep). A high connection drive means it's more reactive.
- **Decoder:** reads each cluster's share of activity and turns it into valence, tension, warmth, playfulness, irritation and arousal. It's fit once at birth. Those six replace the float model's values whenever the neurons are online.
- **Time:** 1 simulated second per real minute, about 4 CPU-minutes per day. When the service restarts after the PC was off, the neurons catch up (gaps over 6 hours become a blackout).
- **No brain, no him.** Once his brain has been born, the float model never speaks as him. If the neurons are offline, your texts queue and you get a gray "his brain is offline" notice. He doesn't text first and doesn't reflect. When the brain is back, he reads the backlog and answers it himself. **The one exception is a crisis message**, which always gets an immediate sincere reply.
- **Stickiness** (`"stickiness"` in `neuro/config.json`, default 1) divides both homeostatic rates. Higher values make moods last longer; see `neuro/TUNING.md` for measured lifetimes. Change it, then restart `START-NEURONS.bat`. It applies to the existing brain; no re-birth needed.
- **Birth** screens candidate wirings and keeps the first one that is healthy, can be decoded, holds a bad mood, and deepens basins over time.
- **What it does** (tests in `test/snn.test.mjs`): after about an hour of hurt, it stays low for roughly 14–16 real hours with no further input, then lifts into its temperament. Early on, a mild kind message can cheer it up; after it has dwelt in a mood, it needs a stronger one. How big that effect is varies with the random wiring. The crisis path fires regardless of neural state.
- Tuning history and knobs: `neuro/TUNING.md`. Probe tools: `neuro/tools/`.

Run it with `START-NEURONS.bat` (the first run asks for your app URL, then is born in about a minute). Keep the window open. To start it with Windows, put a shortcut to it in `shell:startup`.

## Curiosity: the action side
- **Wonders:** the memory pass notes 0–2 things *it* is genuinely curious about from your conversations.
- **Seek impulse:** it acts when curiosity plus its novelty need is high enough, you've been idle 45+ minutes, and there's an open wonder. Even then it's a probability that rises with curiosity; there's no timer, and a flat mood never seeks.
- **Guardrails:** at most 2 a day, 3+ hours apart. Never during quiet hours, while asleep, within 24 hours of a crisis message, or while the brain is offline.
- **Search:** Gemini with Google Search grounding (your Gemini key), falling back to Wikipedia. If both fail, or `SEARCH_ENABLED` is `"0"` in `wrangler.jsonc`, it **ponders** instead. Nothing breaks.
- **What it finds:** web text only enters one digest call, marked as data. The output is its own 1–3 sentence thought. That thought is felt by the neurons as a world event (no "contact" signal, since it isn't you), stored as a memory, and nudges it (+0.15 urge for 12 hours) to bring it up if it's interesting.
- **Log:** ⋯ → "What he's been curious about" shows every wonder, whether it searched or pondered, why, when, sources, and what it made of it.
- **Your one-week test:** set `"SEARCH_ENABLED": "0"`, then run `DEPLOY.bat`.

## The affective core (`src/affect.js`)
Under the LLM is a state machine that persists between messages. The LLM doesn't decide how it feels; the state machine does, and then tells the LLM.
- **Affect (12 dims):** valence, arousal, dominance, attachment, curiosity, boredom, energy, tension, playfulness, warmth, trust, irritation. Each one decays toward a personality baseline at its own speed. Mood takes hours to settle; trust and attachment take weeks.
- **Drives (6):** connection, novelty, rest, mastery, honesty, play. They climb while unmet and drop when satisfied. They bleed into mood: nothing new happening means bored, and nobody around means slightly down.
- **Body clock:** energy follows your local time. It's asleep about 2:30 to 8:30am, and texts sent then wait until it wakes up (a 3rd text in a row wakes it up groggy). A crisis always wakes it.
- **Appraisal:** every message gets one cheap LLM call that scores how it lands. The effect depends on its current state: hostility hits harder when it's already irritated, and good news is harder to feel when it's down. Crisis words are also caught by a regex, so the LLM can't miss them.
- **Emotional memory:** important moments are saved with how it felt at the time. Their strength fades with a roughly one-week half-life, and every time a memory comes up again it fades more slowly. Recall is weighted by strength, recency, how closely the mood matches, and topic overlap. A strong unresolved thread can push its way into a reply, or get it to text you first.
- **Policy:** state decides whether to reply now or sit on it, how long to go, warm or sharp, push back or follow, and joke or not. Those instructions go to the LLM.
- **Heartbeat (cron every 5 min):** time passes, it answers texts it was sitting on, and it might text first depending on how strong its urge is. The urge is connection, attachment, boredom and play combined. If you leave it on read, it gets more hesitant.
- **Reflection (4am):** writes a diary entry, rewrites its self-model, merges duplicate memories, and nudges its baseline by up to ±0.03 per night (±0.25 total). It also retunes how hard things hit it (hostility, warmth, vulnerability, humor, novelty, wins) by up to ±0.05 per night, within 0.6 to 1.5×. That never touches the crisis check.
- **Name:** `FRIEND_NAME` is empty. It picks its own during a nightly reflection, once there are 20+ messages to reflect on, grounded in its state and history. The next time it talks, it tells you the name and why.
- **Cost:** appraisal and memory bookkeeping use `CHEAP_MODEL`. Only the actual replies and the nightly reflection use the main brain.

Tests: `node --test test/affect.test.mjs`. Locally, `DEV=1` enables `/api/debug/warp?hours=72` to fake time passing.

## How it works
- **Every message is saved forever** in a Cloudflare D1 database.
- **Memory:** every 8 messages, a background pass pulls out lasting facts about you, rewrites a "story so far" summary, and schedules follow-ups ("ask how the interview went, Tuesday 6pm"). You can see and delete all of it under ⋯.
- **Texting first:** every 30 minutes, a cron job checks for due follow-ups. If you've been quiet a while, it might send a random check-in, at most once a day. It never double-texts if you left it on read.
- **Voice:** the 🎙 button is talk-to-text. The ⋯ menu has a "read texts out loud" toggle. Real phone calls are a later upgrade.

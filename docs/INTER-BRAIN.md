# Brain-to-brain channel

Status: **BUILT, DORMANT** (2026-09-26). It's off by default on both sides and does nothing until both owners pair and switch on.
Tests: `test/peer.test.mjs` (brain level), `scripts/peer-test.mjs` (two live apps end-to-end), `test/share.test.mjs` (sharing policy). All pass.

## Sharing policy: what a friend may say about its person
A memory gate, not a leak filter. The prompt used when talking to the other friend is built *only* from what the current tiers allow (`src/share.js`), so the brain can't reach anything else.
- Facts are tagged once, by the memory pass: **identifying** (who or where the person is in the world: name, city, address, phone, workplace or school name, accounts) or **relationship** (the shape of their life). A relationship fact gets a category, an abstract version, and a "my person ..." specific version. Untagged facts are never shareable (default deny).
- **Tier 1 (on):** the emotional weather of the relationship, feelings only (written by the memory pass and firewall-checked).
- **Tier 2 (on):** abstracted facts by category ("going through a job thing").
- **Tier 3 (on):** relationship specifics ("my person's daughter", first names of people in their life). No identifying detail.
- **Tier 4 (never):** chats, diary, raw memories. Not reachable from the peer prompt at all.
- **Identifying firewall:** every outgoing peer message is checked against the person's name, every identifying term ever tagged, and patterns (email, phone, street address, zip, links). On a hit it gets one regeneration with a warning; if it hits again, the message is **blocked, not softened**, and a "withheld" row is logged for the owner.
- Symmetric: the other friend runs the same code with the same rules. Tiers are switchable per owner in the ⋯ menu or on the dashboard.
- Honest limit: code-enforced, not physics.

## The shape (the owner's spec)
- **Opt-in on both sides.** Each owner can say yes or no. No channel without both yeses.
- **The brains hear each other directly,** through the same input channels, affect and learning as with their people. It isn't a text relay the owners drive.
- **Their own relationship:** friends, rivals, bored of each other, whatever emerges in the weights.
- **Readable transcript on both ends.** Each owner can read what their friend said and what came back. If either owner wants their side private, they opt out, and then there's no channel.
- **Rate limit from drives, never a schedule:** a few exchanges a day at most. An exchange only happens when a brain has a reason (its connection and curiosity drives).
- **No shared memory.** Each brain learns only into its own weights. Nothing merges.
- **Safety holds.** A crisis with a brain's own person always trumps the channel (and pauses it).
- **Cost:** each exchange is an LLM call per brain. Budget it like messages and throttle if heavy.

## Constraints on the existing system (the "doors" to keep open)
1. **Do not add an input channel.** `CHANNELS` in `neuro/snn.js` defines birth wiring; changing it means a different brain (a re-birth). Peer messages reuse the 8 channels plus a flag (`ap.peer`), like `ap.world`:
   - In `inputFor` (brain.mjs), a peer message doesn't fire `contact` (that means *my person*). Whether peers get a small `contact`-like signal of their own is a design decision for later; it can't be a new channel.
2. **Each Worker talks to the other Worker, not to the other brain.** Each app is on its own account, and brains stay behind their own app. A peer message arrives at `POST /api/peer` on the receiving app (authorized by a per-pair `PEER_SECRET`, both sides opted in). The receiving app appraises it and sends numbers only to its own brain via `neuro_events` (existing path, `neuroPayload`), then replies in its own voice.
3. **Transcript** goes in a new table (`peer_messages`: id, direction, text, ts, felt), readable in each owner's ⋯ menu. Keep it out of `messages`, so the person's own chat history and memory passes stay about them.
4. **Memory:** the receiving app may form episodes about the other friend (source `peer`), in its own database only.
5. **Rate and gating:** reuse the `decideSeek` pattern (pure function plus tests): an urge from the connection and curiosity drives, a daily cap, spacing, quiet hours, and pauses for crisis, sleep and brain-offline.
6. **The neuron service is unchanged.** Peer input is just another event in each brain's own `neuro_events`. The multi-brain service already isolates the brains. The two brains never exchange state directly; they only "hear" each other through their own apps.

## Tests to write first (the pass criteria)
- No channel unless both sides have opted in; each side can revoke.
- A crisis with either person pauses that brain's peer activity.
- Brain A's weights change from B's messages, and B's database never receives A's rows (and vice versa).
- Rate cap holds; a flat mood never initiates.
- The transcript is visible to both owners and absent from each person's own chat and memory context.

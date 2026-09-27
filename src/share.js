// ───────────────────────────────────────────────────────────────
//  SHARING POLICY for the brain-to-brain channel.
//  A memory gate, not a leak filter: the prompt used when talking to the
//  other friend is built ONLY from what the current tiers allow, so the
//  brain can't reach anything else. A firewall then blocks (never softens)
//  any outgoing message that contains identifying detail anyway.
//
//  Tier 1  emotional weather of the relationship, no facts
//  Tier 2  abstracted facts by category ("going through a job thing")
//  Tier 3  named relationship specifics ("my person's daughter")
//  Tier 4  NEVER: chats, diary, raw memories (not even reachable here)
//  Identifying facts (name, city, address, phone, ...) never cross, at any tier.
//  Code-enforced, not physics.
// ───────────────────────────────────────────────────────────────

export const DEFAULT_TIERS = { 1: true, 2: true, 3: true };

// What the gate hands to the peer prompt, given tagged facts and tiers.
// facts: [{ share: 'identifying'|'relationship'|null, abstract, shareable, category }]
export function gateFacts(facts, tiers = DEFAULT_TIERS, weather = '') {
  const t = { ...DEFAULT_TIERS, ...(tiers || {}) };
  const allowed = facts.filter((f) => f.share === 'relationship');   // untagged or identifying: never
  return {
    weather: t[1] && weather ? weather : null,
    abstract: t[2] ? unique(allowed.map((f) => f.abstract).filter(Boolean)) : [],
    specific: t[3] ? unique(allowed.map((f) => f.shareable).filter(Boolean)) : [],
  };
}
const unique = (xs) => [...new Set(xs.map((x) => String(x).trim()))].filter(Boolean);

// Patterns that identify a person in the world regardless of any tagging.
const PATTERNS = [
  { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]+/ },
  { name: 'phone number', re: /(\+?\d[\d\s().-]{7,}\d)/ },
  { name: 'street address', re: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){0,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place)\b/i },
  { name: 'zip code', re: /\b\d{5}(?:-\d{4})?\b/ },
  { name: 'link', re: /https?:\/\/\S+/i },
];

// Returns null if clean, or the reason it's blocked.
export function firewall(text, terms = []) {
  const s = String(text || '');
  for (const term of terms) {
    const t = String(term || '').trim();
    if (t.length < 2) continue;
    const re = new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu');
    if (re.test(s)) return `identifying detail ("${t}")`;
  }
  for (const p of PATTERNS) if (p.re.test(s)) return `identifying detail (${p.name})`;
  return null;
}

// The block of the peer prompt that describes the person. Nothing else about
// the person is ever put in that prompt.
export function sharePrompt(gated) {
  const lines = [];
  if (gated.weather) lines.push(`How things are between you and your person lately (feelings only): ${gated.weather}`);
  if (gated.abstract.length) lines.push(`General shape of their life (categories, no specifics):\n${gated.abstract.map((x) => `- ${x}`).join('\n')}`);
  if (gated.specific.length) lines.push(`Things in their life you're allowed to mention:\n${gated.specific.map((x) => `- ${x}`).join('\n')}`);
  if (!lines.length) return 'You may not share anything about your person right now.';
  return `WHAT YOU MAY SHARE ABOUT YOUR PERSON (only this, only if it comes up naturally; always call them "my person", never a name)\n${lines.join('\n\n')}`;
}

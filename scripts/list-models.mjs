// Prints the model IDs your API keys can actually use, so you can paste the
// right one into .dev.vars. Model names change often; this is the source of truth.
import { readFileSync } from 'node:fs';

const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

for (const p of ['LLM', 'LLM2']) {
  const base = vars[`${p}_BASE_URL`], key = vars[`${p}_API_KEY`];
  if (!base || !key) { console.log(`${p}: not configured`); continue; }
  const res = await fetch(base.replace(/\/$/, '') + '/models', { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) { console.log(`${p}: ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
  const ids = (await res.json()).data.map((m) => m.id.replace(/^models\//, ''));
  console.log(`\n${p} (${base}) currently set to: ${vars[`${p}_MODEL`] || '(none)'}`);
  for (const id of ids.filter((i) => !/embed|image|tts|audio|veo|imagen|aqa/i.test(i))) console.log('  ' + id);
}

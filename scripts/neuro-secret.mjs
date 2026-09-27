// Makes sure .dev.vars has a NEURO_SECRET (the password the brain host uses).
// With --show, prints the line to send to whoever hosts your brain.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const path = new URL('../.dev.vars', import.meta.url);
let vars = existsSync(path) ? readFileSync(path, 'utf8') : '';
let secret = (vars.match(/^NEURO_SECRET=(.+)$/m) || [])[1]?.trim();
if (!secret) {
  secret = randomBytes(24).toString('hex');
  writeFileSync(path, vars.trimEnd() + `\n\n# Password for whoever hosts your brain's neurons.\nNEURO_SECRET=${secret}\n`);
}
if (process.argv.includes('--show')) {
  console.log('\nSend this ONE line to whoever is hosting your brain (and nothing else from that file):\n');
  console.log(`NEURO_SECRET=${secret}\n`);
}

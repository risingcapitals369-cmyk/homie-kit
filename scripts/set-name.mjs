// First-run: asks whose friend this is and writes it into wrangler.jsonc.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const path = new URL('../wrangler.jsonc', import.meta.url);
const text = readFileSync(path, 'utf8');
if (!/"USER_NAME": "YOUR_NAME"/.test(text)) process.exit(0);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const name = (await rl.question("What's your first name? (your friend will call you this) ")).trim().replace(/"/g, '');
rl.close();
if (!name) { console.log('No name entered; run SETUP.bat again.'); process.exit(1); }
writeFileSync(path, text.replace('"USER_NAME": "YOUR_NAME"', `"USER_NAME": "${name}"`));
console.log(`Got it, ${name}. Your friend starts as a stranger and picks its own name later.`);

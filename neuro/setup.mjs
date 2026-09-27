// Creates neuro/config.json and a shared NEURO_SECRET (also written to .dev.vars,
// which DEPLOY.bat uploads). usage: node neuro/setup.mjs [workerUrl]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const varsPath = join(here, '..', '.dev.vars');
const cfgPath = join(here, 'config.json');

let vars = existsSync(varsPath) ? readFileSync(varsPath, 'utf8') : '';
let secret = (vars.match(/^NEURO_SECRET=(.+)$/m) || [])[1]?.trim();
if (!secret) {
  secret = randomBytes(24).toString('hex');
  vars = vars.trimEnd() + `\n\n# Shared with the neuron service on your PC (neuro/config.json).\nNEURO_SECRET=${secret}\n`;
  writeFileSync(varsPath, vars);
}

const old = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const cfg = {
  workerUrl: process.argv[2] || old.workerUrl || 'http://localhost:8799',
  secret,
  size: old.size || 'full',
  stickiness: old.stickiness || 1,   // how long moods last; see neuro/TUNING.md
  backupDir: old.backupDir || join(homedir(), 'homie-brain-backup'),
};
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`neuro/config.json -> ${cfg.workerUrl} (backup copies in ${cfg.backupDir})`);

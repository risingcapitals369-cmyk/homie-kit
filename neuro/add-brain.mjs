// Host another person's brain in this neuron service (their app stays theirs;
// this PC only ever receives numbers). usage: node neuro/add-brain.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const path = new URL('./config.json', import.meta.url);
if (!existsSync(path)) { console.log('Set up your own brain first (START-NEURONS.bat).'); process.exit(1); }
let cfg = JSON.parse(readFileSync(path, 'utf8'));
if (!cfg.brains) cfg = { brains: [{ id: 'main', workerUrl: cfg.workerUrl, secret: cfg.secret, stickiness: cfg.stickiness, size: cfg.size }], backupDir: cfg.backupDir };

const rl = createInterface({ input: process.stdin, output: process.stdout });
const id = (await rl.question('Short name for this brain (e.g. sam): ')).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
const workerUrl = (await rl.question('Their app link (https://....workers.dev): ')).trim();
const secret = (await rl.question('Their NEURO_SECRET (they send you this one line): ')).trim().replace(/^NEURO_SECRET=/, '');
rl.close();
if (!id || !/^https:\/\//.test(workerUrl) || secret.length < 20) { console.log('Something was missing; nothing changed.'); process.exit(1); }
if (cfg.brains.some((b) => b.id === id)) { console.log(`A brain called "${id}" already exists; nothing changed.`); process.exit(1); }
cfg.brains.push({ id, workerUrl, secret, stickiness: 1 });
writeFileSync(path, JSON.stringify(cfg, null, 2));
console.log(`Added "${id}". Close the neurons window and run START-NEURONS.bat again: it'll be born in a minute or two.`);

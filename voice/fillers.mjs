// Short "hm"-type fillers in the chosen voice, played while a slow turn retries.
// usage: node voice/fillers.mjs [voice]   → public/voice/filler-1..3.wav
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = readFileSync(join(root, '.dev.vars'), 'utf8').match(/^LLM2_API_KEY=(.+)$/m)[1].trim();
const VOICE = process.argv[2] || 'Charon';
const OUT = join(root, 'public', 'voice'); mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LINES = ['hm.', 'hmm, hold on.', 'mm, wait.'];
const wav = (pcm, rate = 24000) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40); return Buffer.concat([h, pcm]);
};
// Trim leading/trailing near-silence.
const trim = (pcm) => {
  const loud = (i) => Math.abs(pcm.readInt16LE(i)) > 600;
  let a = 0, b = pcm.length - 2;
  while (a < b && !loud(a)) a += 2;
  while (b > a && !loud(b)) b -= 2;
  return pcm.subarray(Math.max(0, a - 2400), Math.min(pcm.length, b + 4800));
};
for (let i = 0; i < LINES.length; i++) {
  const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`);
  const chunks = []; let ready = false, done = false;
  ws.onmessage = async (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString('utf8'));
    if (m.setupComplete) ready = true;
    for (const p of m.serverContent?.modelTurn?.parts || []) if (p.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, 'base64'));
    if (m.serverContent?.turnComplete) done = true;
  };
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ setup: { model: 'models/gemini-3.8-live', generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
    systemInstruction: { parts: [{ text: 'You make one tiny thinking sound, like a guy on the phone who needs a second. Say exactly the words given, casual and low, nothing else.' }] } } }));
  while (!ready) await sleep(50);
  ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: `Say exactly: "${LINES[i]}"` }] }], turnComplete: true } }));
  for (let k = 0; k < 200 && !done; k++) await sleep(50);
  ws.close();
  const pcm = trim(Buffer.concat(chunks));
  writeFileSync(join(OUT, `filler-${i + 1}.wav`), wav(pcm));
  console.log(`filler-${i + 1}.wav "${LINES[i]}" ${(pcm.length / 48000).toFixed(2)}s (${VOICE})`);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetwork, SMALL } from '../neuro/snn.js';
import { inputFor, advanceTo, REAL_MS_PER_SIM_MS, MAX_CATCHUP_REAL_MS } from '../neuro/brain.mjs';

test('a message becomes input spikes on its channels, plus contact', () => {
  const r = inputFor({ warmth: 0.5, hostility: 0, humor: 1 });
  assert.equal(r.warmth, 30);
  assert.equal(r.humor, 60);
  assert.equal(r.contact, 30);
  assert.equal(r.hostility, undefined);
});

test('something it found on its own is felt, but not as contact with him', () => {
  const r = inputFor({ world: true, novelty: 0.8, humor: 0.5 });
  assert.equal(r.contact, undefined);
  assert.equal(r.novelty, 48);
});

test('a crisis always drives the vulnerability channel hard', () => {
  assert.equal(inputFor({ crisis: true, vulnerability: 0.1 }).vulnerability, 60);
});

test('time: 1 sim-second per real minute; long gaps become a capped blackout', () => {
  const net = createNetwork({ ...SMALL, nE: 80, nI: 20, pConn: 0.5 }); // tiny: just timing
  net.realTs = 0;
  const a = advanceTo(net, 10 * 60e3);             // 10 real minutes
  assert.equal(a.simMs, 10 * 60e3 / REAL_MS_PER_SIM_MS);
  assert.equal(a.blackoutMs, 0);
  const b = advanceTo(net, net.realTs + MAX_CATCHUP_REAL_MS + 5 * 3600e3, { maxSimMs: 1000 });
  assert.equal(b.blackoutMs, 5 * 3600e3, 'anything past the cap is a blackout');
  assert.equal(b.simMs, 1000, 'catch-up is chunked so a sync never stalls');
});

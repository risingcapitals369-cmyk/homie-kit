import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateFacts, firewall, sharePrompt } from '../src/share.js';

// Made-up sample person (never use a real person's details in tests: the friend kit ships them).
const FACTS = [
  { share: 'identifying', abstract: 'lives in a city', shareable: 'lives in Springfield', category: 'other' },
  { share: 'relationship', abstract: 'has family stuff going on', shareable: "my person has a young son", category: 'family' },
  { share: 'relationship', abstract: 'going through a job thing', shareable: 'my person is looking for a new job', category: 'work' },
  { share: null, abstract: 'untagged', shareable: 'untagged fact', category: 'other' },
];

test('memory gate: identifying and untagged facts are unreachable at every tier', () => {
  const g = gateFacts(FACTS, { 1: true, 2: true, 3: true }, 'been close lately');
  const all = JSON.stringify(g);
  assert.doesNotMatch(all, /Springfield|lives in a city|untagged/);
  assert.equal(g.specific.length, 2);
  assert.equal(g.abstract.length, 2);
  assert.equal(g.weather, 'been close lately');
});

test('tiers switch each layer independently', () => {
  assert.deepEqual(gateFacts(FACTS, { 1: false, 2: false, 3: false }, 'x'), { weather: null, abstract: [], specific: [] });
  const onlyWeather = gateFacts(FACTS, { 1: true, 2: false, 3: false }, 'x');
  assert.equal(onlyWeather.weather, 'x');
  assert.equal(onlyWeather.specific.length + onlyWeather.abstract.length, 0);
  const t2 = gateFacts(FACTS, { 1: false, 2: true, 3: false });
  assert.ok(t2.abstract.length === 2 && t2.specific.length === 0);
  assert.match(sharePrompt({ weather: null, abstract: [], specific: [] }), /may not share anything/);
});

test('firewall blocks identifying detail (never softens)', () => {
  const terms = ['Alex', 'Springfield'];
  assert.match(firewall('my guy alex is wild', terms), /Alex/);
  assert.match(firewall('he lives in springfield lol', terms), /Springfield/);
  assert.match(firewall('hit him at 352-555-0142', terms), /phone/);
  assert.match(firewall('email him jd@gmail.com', terms), /email/);
  assert.match(firewall('he stays at 1200 Maple Ave', terms), /address/);
  assert.equal(firewall('my person has a young son and a job thing going on', terms), null);
  assert.equal(firewall('alexander and springfielder are not whole-word matches', terms), null, 'whole words only');
});

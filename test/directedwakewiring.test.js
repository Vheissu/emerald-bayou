import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every retained powered-craft director contributes to the player wake field', async () => {
  const [main, npc, encounters, incidents, passage, stormline, contracts, story, aftermath] = await Promise.all([
    'main.js', 'npc.js', 'encounters.js', 'incidents.js', 'passage.js', 'stormline.js', 'contracts.js', 'story.js', 'aftermath.js',
  ].map(file => readFile(join(root, 'src', file), 'utf8')));

  assert.match(main, /const physicalWakeFields = \[life\.traffic\]/);
  assert.match(main, /physicalWakeFields\.push\(skiff, encounters, incidents, story, aftermath\)/);
  assert.match(main, /sampleWakeFields\(physicalWakeFields, x, z, t\)/);
  for (const source of [npc, encounters, incidents, passage, stormline, contracts, story, aftermath]) assert.match(source, /wakeHeightAt\(x, z, t\)/);
  assert.match(story, /this\.passage\?\.wakeHeightAt/);
  assert.match(story, /this\.stormLine\?\.wakeHeightAt/);
  assert.match(story, /this\.contracts\?\.wakeHeightAt/);
});

test('small story boat pools are retained instead of rebuilt in wake and stamp loops', async () => {
  const [stormline, contracts] = await Promise.all([
    readFile(join(root, 'src', 'stormline.js'), 'utf8'),
    readFile(join(root, 'src', 'contracts.js'), 'utf8'),
  ]);
  assert.match(stormline, /this\.agents = \[this\.convoy, this\.chaser\]/);
  assert.match(stormline, /for \(const A of this\.agents\)/);
  assert.match(contracts, /this\.agents = \[this\.rigs\.patrolAgent, this\.rigs\.receiverAgent\]/);
  assert.match(contracts, /for \(const A of this\.agents\)/);
});

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { World } = await import(pathToFileURL(join(process.cwd(), 'src/kernel/world.ts')).href);
const restore = World.restore;
World.restore = function(data) {
  const world = restore.call(this, data, 4242);
  world.creatures.clear();
  for (const creature of data.benchmarkCreatures ?? []) world.creatures.set(creature.id, creature);
  world.syncIndex();
  const snapshot = world.snapshot.bind(world);
  let previous = '';
  world.snapshot = function() {
    const result = snapshot();
    if ([...world.wizards.values()].filter(w => !w.npc && w.connections > 0).length >= Number(process.env.BENCH_EXPECTED_CLIENTS ?? 21)) {
      const json = JSON.stringify(result);
      if (json === previous) return result;
      previous = json;
      writeFileSync(join(process.env.PERF_TMP, 'witness.json'), JSON.stringify({
        now: world.now, wizardCount: world.wizards.size, creatureCount: world.creatures.size,
        connectedCount: [...world.wizards.values()].filter(w => w.connections > 0).length,
        snapshotSha256: createHash('sha256').update(json).digest('hex'),
      }, null, 2));
    }
    return result;
  };
  return world;
};
World.prototype.tick = function() {};
// The real client still sends aim updates; holding tick alone does not freeze wizard.facing.
World.prototype.setInput = function() {};

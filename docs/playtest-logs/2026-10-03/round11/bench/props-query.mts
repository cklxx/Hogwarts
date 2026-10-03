/** Props-only query payload, not FPS or latency. Run: npx tsx <this-file> <repository-root> */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.argv[2] ?? process.cwd();
const { World } = await import(pathToFileURL(resolve(repo, 'src/kernel/world.ts')).href);
const world = new World({ seed: 43, secret: 'exploration-baseline' });
const wizard = world.enroll('Query Reader', 'Ravenclaw').wizard;
wizard.pos = { x: -82, z: 26 };
for (const radius of [10, 12, 40, 80]) {
  const props = world.look(wizard.id, radius).props ?? [];
  console.log(JSON.stringify({
    radius, count: props.length,
    maxDistance: Math.max(0, ...props.map((prop: { x: number; z: number }) => Math.hypot(prop.x - wizard.pos.x, prop.z - wizard.pos.z))),
    propsBytes: Buffer.byteLength(JSON.stringify(props)),
  }));
}

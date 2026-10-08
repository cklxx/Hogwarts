/** The 20 Hz clock and process lifecycle, separate from request handling and gameplay. */
import { TICK } from '../kernel/world.js';
export function startRuntime(options: {
  tick(dt: number): void;
  checkpoints: { save(): Promise<void>; flush(): Promise<void> };
  stop(): void;
}) {
  let stopping = false;
  let last = performance.now(), acc = 0;
  const tick = setInterval(() => {
    const t = performance.now();
    acc += Math.min(1, (t - last) / 1000); last = t;
    while (acc >= TICK) { options.tick(TICK); acc -= TICK; }
  }, 1000 * TICK);
  const checkpoint = setInterval(() => {
    void options.checkpoints.save().catch(() => { console.error('[hogwarts] checkpoint failed; previous save preserved. 检查点写入失败，保留上次存档。'); });
  }, 30_000);
  const halt = () => { stopping = true; clearInterval(tick); clearInterval(checkpoint); };
  const fatal = (error: unknown) => {
    halt();
    // A tick or callback may have mutated only half the world. Never persist that state.
    // Keep call sites for diagnosis; error messages may contain user input or a secret from a failed parse.
    const frames = error instanceof Error ? error.stack?.split('\n').filter((s) => /^\s+at /.test(s)).join('\n') : '';
    console.error('[hogwarts] fatal runtime error; exiting without saving. 致命异常，保留上次存档。', frames ?? '');
    process.exit(1);
  };
  const shutdown = () => {
    if (stopping) return;
    halt();
    options.stop();
    const timeout = setTimeout(() => { console.error('[hogwarts] shutdown checkpoint timed out; previous save retained.'); process.exit(1); }, 10_000);
    void options.checkpoints.flush().then(() => {
      clearTimeout(timeout);
      console.log('\n[hogwarts] saved. Mischief managed.'); process.exit(0);
    }, () => { clearTimeout(timeout); console.error('[hogwarts] shutdown checkpoint failed; previous save retained.'); process.exit(1); });
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  process.on('uncaughtException', fatal); process.on('unhandledRejection', fatal);
}

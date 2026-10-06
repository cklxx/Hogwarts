/** Disk failures must never turn a persistent world into a fresh world. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { World } from '../kernel/world.js';
import type { FamiliarsSave } from './familiar.js';

/** Only a missing file is a new installation. Diagnostics never include save contents. */
export function readSave<T>(path: string, restore: (data: unknown) => T): T | undefined {
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read save ${path}; startup stopped, file preserved.`);
  }
  try { return restore(JSON.parse(raw)); }
  catch { throw new Error(`Cannot restore save ${path}; startup stopped, file preserved.`); }
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Check the stable envelope before legacy migrations; do not silently load a future format. */
export function restoreWorld(data: unknown): World {
  if (!record(data) || (data.version !== undefined && data.version !== 1 && data.version !== 2)
    || typeof data.secret !== 'string' || !data.secret || !finite(data.now) || data.now < 0
    || !record(data.term) || !Number.isInteger(data.term.n) || !finite(data.term.startedAt) || !finite(data.term.endsAt)
    || !Array.isArray(data.wizards)) throw new Error('Invalid world save');
  const ids = new Set<string>(), tokens = new Set<string>();
  for (const w of data.wizards) {
    if (!record(w) || typeof w.id !== 'string' || !w.id || ids.has(w.id)
      || typeof w.token !== 'string' || !w.token || tokens.has(w.token)
      || !record(w.pos) || !finite(w.pos.x) || !finite(w.pos.z) || !finite(w.hp) || !finite(w.mana)) throw new Error('Invalid wizard save');
    ids.add(w.id); tokens.add(w.token);
  }
  return World.restore(data as unknown as ReturnType<World['serialize']>);
}

/** Do not reset Agent quotas or forget bonds when a companion save is damaged. */
export function familiarSave(data: unknown): FamiliarsSave {
  const quota = (q: unknown) => record(q) && typeof q.day === 'string' && finite(q.n) && Number.isInteger(q.n) && q.n >= 0;
  if (!record(data) || !Array.isArray(data.bonds) || !Array.isArray(data.perWizard) || !quota(data.global)
    || data.bonds.some((b) => !record(b) || typeof b.wid !== 'string' || typeof b.kind !== 'string' || !finite(b.after) || b.after < 0)
    || data.perWizard.some((q) => !Array.isArray(q) || q.length !== 2 || typeof q[0] !== 'string' || !quota(q[1]))) throw new Error('Invalid familiar save');
  return data as unknown as FamiliarsSave;
}

type AtomicIo = Pick<typeof fs, 'mkdir' | 'open' | 'rename' | 'rm'>;
/** Sync file bytes before replacement; failed writes leave the previous checkpoint intact. */
export async function writeAtomic(path: string, body: string, io: AtomicIo = fs): Promise<void> {
  await io.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  let file: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    file = await io.open(tmp, 'wx', 0o600);
    await file.writeFile(body, 'utf8');
    await file.sync();
    await file.close(); file = undefined;
    await io.rename(tmp, path);
  } finally {
    await file?.close().catch(() => {});
    await io.rm(tmp, { force: true }).catch(() => {});
  }
}

export interface SaveFile { path: string; data: unknown }
/** At most one checkpoint in flight: slow disks cannot create an unbounded queue of worlds. */
export class Checkpoints {
  private pending: Promise<void> | null = null;
  constructor(private capture: () => SaveFile[], private write = writeAtomic) {}
  save(): Promise<void> {
    if (this.pending) return this.pending;
    const work = async () => {
      // Capture and stringify all files synchronously before any I/O; no mutable references survive a tick.
      const files = this.capture().map((f) => ({ path: f.path, body: JSON.stringify(f.data) }));
      for (const f of files) await this.write(f.path, f.body);
    };
    const p = work().finally(() => { this.pending = null; });
    this.pending = p;
    return p;
  }
  /** A clean shutdown needs a final snapshot, even if an earlier checkpoint was still writing. */
  async flush(): Promise<void> {
    await this.pending?.catch(() => {});
    await this.save();
  }
}

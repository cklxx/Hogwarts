/**
 * The Owl Post keyring (docs/AGENT_LINK.md §A.1): where the stdio bridge (and scripts/bot.ts) keep a
 * wizard's key between sessions.
 *
 *   ~/.hogwarts/credentials.json      (Windows: %APPDATA%\hogwarts\credentials.json; HOGWARTS_KEYRING overrides)
 *   directory 0700, file 0600, written atomically (temporary file + rename)
 *   { "version": 1, "keys": { "<origin+pathname of the MCP URL>": { token, registry, name, savedAt } } }
 *
 * Keys are per MCP endpoint, keyed by origin + pathname, so ?realm=… and other query strings do not
 * split one endpoint into several entries. Nothing here ever prints a token.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface KeyEntry { token: string; registry?: string; name?: string; savedAt: string }
export interface Keyring { version: 1; keys: Record<string, KeyEntry> }

/** Where the keyring lives. */
export function keyringPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HOGWARTS_KEYRING) return env.HOGWARTS_KEYRING;
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'hogwarts', 'credentials.json');
  return join(env.HOME || homedir(), '.hogwarts', 'credentials.json');
}

/** The path as a person would write it (~ for the home directory), for messages. */
export function displayPath(file: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || homedir();
  return home && file.startsWith(home + '/') ? '~' + file.slice(home.length) : file;
}

/** The keyring entry name for an MCP URL: origin + pathname (no query, no fragment, no trailing slash). */
export function keyFor(url: string | URL): string {
  const u = new URL(String(url));
  return u.origin + (u.pathname.replace(/\/+$/, '') || '/');
}

/** The keyring, or an empty one if the file is missing or unreadable. */
export function readKeyring(file = keyringPath()): Keyring {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Keyring>;
    if (j && typeof j === 'object' && j.keys && typeof j.keys === 'object') return { version: 1, keys: j.keys };
  } catch { /* missing or corrupt: start empty */ }
  return { version: 1, keys: {} };
}

export function loadKey(url: string | URL, file = keyringPath()): KeyEntry | null {
  const e = readKeyring(file).keys[keyFor(url)];
  return e && typeof e.token === 'string' && e.token ? e : null;
}

/**
 * Store the key for an MCP URL. Throws if it cannot be written (the caller then passes the key through
 * to its human instead of pretending it was saved). The directory is made 0700 and the file 0600;
 * the file is replaced atomically, so a crash never leaves half a keyring.
 */
export function saveKey(url: string | URL, entry: { token: string; registry?: string; name?: string }, file = keyringPath()): KeyEntry {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* not ours to change (e.g. a shared directory): the file itself is 0600 */ }
  const ring = readKeyring(file);
  const saved: KeyEntry = { token: entry.token, ...(entry.registry ? { registry: entry.registry } : {}), ...(entry.name ? { name: entry.name } : {}), savedAt: new Date().toISOString() };
  ring.keys[keyFor(url)] = saved;
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(ring, null, 2) + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never created */ }
    throw e;
  }
  return saved;
}

/**
 * Owl Post keys and pairing codes (docs/AGENT_LINK.md §A.2/A.3): the pure parts. The state lives in
 * World (tokenIndex, pairCodes); these helpers are shared with the server's front door, which routes a
 * realm-prefixed code ("2-ABC-DEF") to its realm before any session exists.
 */
import { randomInt } from 'node:crypto';
import { PAIR_ALPHABET, PAIR_LEN } from '../shared/constants.js';

/** The one refusal for a pairing code that is unknown, already used, expired, or malformed. */
export const PAIR_REFUSAL = 'That pairing code does not work (unknown, used or expired). Open the Owl Post in the game (Esc) and generate a new one.';
/** Too many wrong codes in this realm in the last minute: every attempt is refused until the window clears. */
export const PAIR_THROTTLED = 'Too many wrong pairing codes here in the last minute. Wait a minute, then try again.';

/** The realm number in a token prefix ("r2." -> 2), or null outside realm mode. */
export function realmOfPrefix(tokenPrefix: string): number | null {
  const m = /^r(\d{1,4})\.$/.exec(tokenPrefix);
  return m ? Number(m[1]) : null;
}

/** A fresh code body (PAIR_LEN characters of PAIR_ALPHABET), from the OS's CSPRNG — never the world's seeded RNG. */
export function randomPairBody(): string {
  let s = '';
  for (let i = 0; i < PAIR_LEN; i++) s += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  return s;
}

/** How a code is shown to people: ABC-DEF, or 2-ABC-DEF in realm 2. */
export function formatPairCode(body: string, realm: number | null): string {
  const half = Math.ceil(body.length / 2);
  return `${realm === null ? '' : `${realm}-`}${body.slice(0, half)}-${body.slice(half)}`;
}

/**
 * Normalise what someone typed or said: case, spaces, dashes and dots do not matter. A code is
 * PAIR_LEN alphabet characters, optionally preceded by a realm number ("2-ABC-DEF", "2 abc def",
 * "2abcdef"). The realm is recognised by length, so a code whose body starts with digits is not
 * mistaken for a prefixed one. Returns null for anything that cannot be a code.
 */
export function parsePairCode(raw: string): { realm: number | null; body: string } | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const compact = raw.toUpperCase().replace(/[\s\-_.–—:·]/g, '');
  if (compact.length < PAIR_LEN) return null;
  const body = compact.slice(-PAIR_LEN);
  const prefix = compact.slice(0, compact.length - PAIR_LEN);
  if (prefix && !/^\d{1,4}$/.test(prefix)) return null;
  for (const c of body) if (!PAIR_ALPHABET.includes(c)) return null;
  return { realm: prefix ? Number(prefix) : null, body };
}

/**
 * The key two names collide on (World.enroll: a name is one wizard's): compatibility forms folded (NFKC: full-width
 * letters), accents dropped, case ignored, spaces _ . ' - ignored, and the Cyrillic and Greek letters that look like
 * Latin ones read as those. "Harry Potter", "harry_potter", "Hárry.Potter" and "Hаrry Potter" (a Cyrillic а) are one
 * name, so nobody can pass for someone else.
 */
const LOOKALIKE: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', һ: 'h',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', μ: 'u', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w',
};
export function nameKey(name: string): string {
  const s = name.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s_.'\-]/g, '');
  let out = '';
  for (const ch of s) out += LOOKALIKE[ch] ?? ch;
  return out;
}

/**
 * Owl Post keys (docs/AGENT_LINK.md §A.2/A.3): the token index, key rotation and pairing codes —
 * and the rule that a token never shows up anywhere but in the hands of its owner.
 */
import { describe, expect, it } from 'vitest';
import { PAIR_REFUSAL, PAIR_THROTTLED, World } from '../src/kernel/world.js';
import { formatPairCode, parsePairCode, realmOfPrefix } from '../src/kernel/identity.js';
import { PAIR_ALPHABET, PAIR_FAIL_PER_IP_PER_MIN, PAIR_FAIL_PER_REALM_PER_MIN, PAIR_LEN, PAIR_SPACE, PAIR_TTL_S } from '../src/shared/constants.js';
import type { Wizard } from '../src/kernel/types.js';

function mk(opts: { tokenPrefix?: string } = {}) {
  const w = new World({ seed: 5, secret: 'x', ...opts });
  w.rules.creatures.spawnMultiplier = 0;
  return w;
}
function join(w: World, name: string): Wizard {
  const x = w.enroll(name).wizard;
  x.connections = 1;
  return x;
}
const run = (w: World, s: number) => { for (let t = 0; t < s; t += 0.05) w.tick(0.05); };

/** Every place a wizard's data leaves the kernel for someone who is not holding the token. */
function publicSurfaces(w: World, viewer: Wizard) {
  return JSON.stringify([
    w.snapshot(), w.privateState(viewer.id), w.look(viewer.id), w.whoami(viewer.id), w.armory(viewer.id), w.leaderboard(),
    w.events, w.events.map((e) => w.wireEvent(e)), w.marauderMap(viewer.id), w.inboxFor(viewer.id), w.owlsFor(viewer.id),
  ]);
}

describe('the token index', () => {
  it('finds a wizard by token in O(1), misses unknown tokens, and survives a restart', () => {
    const w = mk();
    const a = join(w, 'Alice'), b = join(w, 'Bob');
    expect(w.byToken(a.token)).toBe(a);
    expect(w.byToken(b.token)).toBe(b);
    expect(w.byToken('nope')).toBeUndefined();
    expect(w.byToken('')).toBeUndefined();
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(w2.byToken(a.token)?.id).toBe(a.id);
    expect(w2.byToken(b.token)?.id).toBe(b.id);
  });

  it('never answers from a stale entry', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const old = a.token;
    a.token = 'edited-directly';
    expect(w.byToken(old)).toBeUndefined();
  });
});

describe('rotating a key', () => {
  it('kills the old token at once, keeps the registry and handle, and never prints either token', () => {
    const w = mk();
    const a = join(w, 'Alice');
    join(w, 'Bob');
    const old = a.token, id = a.id, handle = a.handle;
    const fresh = w.rotateToken(a.id);
    expect(fresh).not.toBe(old);
    expect(a.token).toBe(fresh);
    expect(w.byToken(old)).toBeUndefined();
    expect(w.byToken(fresh)).toBe(a);
    expect([a.id, a.handle]).toEqual([id, handle]);
    const all = publicSurfaces(w, a);
    expect(all).not.toContain(old);
    expect(all).not.toContain(fresh);
    expect(w.events.at(-1)).toMatchObject({ to: a.id, type: 'system' });
    expect(w.events.at(-1)!.zh).toMatch(/密钥/);
    // and after a restart only the new one works
    const w2 = World.restore(JSON.parse(JSON.stringify(w.serialize())));
    expect(w2.byToken(old)).toBeUndefined();
    expect(w2.byToken(fresh)?.id).toBe(a.id);
  });

  it('keeps the realm prefix', () => {
    const w = mk({ tokenPrefix: 'r3.' });
    const a = join(w, 'Realm Three');
    expect(a.token.startsWith('r3.')).toBe(true);
    expect(w.rotateToken(a.id)).toMatch(/^r3\.[A-Za-z0-9_-]{24}$/);
  });

  it('kills the live pairing code minted under the old key', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const { code } = w.mintPairCode(a.id);
    w.rotateToken(a.id);
    expect(() => w.redeemPairCode(code)).toThrow(PAIR_REFUSAL);
  });
});

describe('pairing codes', () => {
  it('are 6 characters of the 31-letter alphabet, shown ABC-DEF, and bind exactly once', () => {
    expect(PAIR_ALPHABET).toHaveLength(31);
    expect(PAIR_SPACE).toBe(31 ** 6);
    const w = mk();
    const a = join(w, 'Alice');
    const c = w.mintPairCode(a.id);
    expect(c.code).toMatch(new RegExp(`^[${PAIR_ALPHABET}]{3}-[${PAIR_ALPHABET}]{3}$`));
    expect(c.expiresIn).toBe(PAIR_TTL_S);
    expect(w.pairCodeOf(a.id)?.code).toBe(c.code);
    expect(w.redeemPairCode(c.code)).toBe(a);
    expect(w.pairCodeOf(a.id)).toBeNull();
    expect(() => w.redeemPairCode(c.code)).toThrow(PAIR_REFUSAL); // single use
    expect(w.events.some((e) => e.to === a.id && /pairing code/.test(e.text) && /配对码/.test(e.zh ?? ''))).toBe(true);
  });

  it('normalise case, spaces and dashes', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const { code } = w.mintPairCode(a.id);
    const loose = ` ${code.toLowerCase().replace('-', ' ')} `;
    expect(w.redeemPairCode(loose)).toBe(a);
    expect(parsePairCode('abc-def')).toEqual({ realm: null, body: 'ABCDEF' });
    expect(parsePairCode('2-ABC-DEF')).toEqual({ realm: 2, body: 'ABCDEF' });
    expect(parsePairCode('2 abc def')).toEqual({ realm: 2, body: 'ABCDEF' });
    // a body that starts with digits is not mistaken for a realm prefix
    expect(parsePairCode('234-567')).toEqual({ realm: null, body: '234567' });
    expect(parsePairCode('12-234-567')).toEqual({ realm: 12, body: '234567' });
    // look-alikes are not in the alphabet
    for (const bad of ['ABC-DE0', 'IBC-DEF', 'ABC-DE', 'X-ABC-DEF', '', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF']) expect(parsePairCode(bad)).toBeNull();
    expect(formatPairCode('ABCDEF', null)).toBe('ABC-DEF');
    expect(formatPairCode('ABCDEF', 2)).toBe('2-ABC-DEF');
  });

  it('expire after PAIR_TTL_S', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const { code } = w.mintPairCode(a.id);
    run(w, PAIR_TTL_S - 1);
    expect(w.pairCodeOf(a.id)?.code).toBe(code);
    run(w, 1.5);
    expect(w.pairCodeOf(a.id)).toBeNull();
    expect(() => w.redeemPairCode(code)).toThrow(PAIR_REFUSAL);
  });

  it('an expired code is refused even before the sweep removes it', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const { code } = w.mintPairCode(a.id);
    w.now += PAIR_TTL_S; // no tick: nothing has been swept
    expect(() => w.redeemPairCode(code)).toThrow(PAIR_REFUSAL);
  });

  it('only one live code per wizard: minting again kills the previous one', () => {
    const w = mk();
    const a = join(w, 'Alice'), b = join(w, 'Bob');
    const first = w.mintPairCode(a.id).code;
    const other = w.mintPairCode(b.id).code;
    const second = w.mintPairCode(a.id).code;
    expect(() => w.redeemPairCode(first)).toThrow(PAIR_REFUSAL);
    expect(w.redeemPairCode(other)).toBe(b);
    expect(w.redeemPairCode(second)).toBe(a);
  });

  it('carry the realm, and a code for another realm is refused like any other', () => {
    const w = mk({ tokenPrefix: 'r2.' });
    expect(w.realmId).toBe(2);
    expect(realmOfPrefix('r2.')).toBe(2);
    expect(realmOfPrefix('')).toBeNull();
    const a = join(w, 'Alice');
    const { code } = w.mintPairCode(a.id);
    expect(code).toMatch(/^2-[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const body = code.slice(2);
    expect(() => w.redeemPairCode(`3-${body}`)).toThrow(PAIR_REFUSAL);
    expect(w.redeemPairCode(body)).toBe(a); // the prefix is optional inside the right realm
    const single = mk();
    const s = join(single, 'Solo');
    expect(single.mintPairCode(s.id).code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  });

  it('every failure looks the same, and a realm stops checking after PAIR_FAIL_PER_REALM_PER_MIN failures a minute', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const { code } = w.mintPairCode(a.id);
    const msgs = new Set<string>();
    for (let i = 0; i < PAIR_FAIL_PER_REALM_PER_MIN; i++) {
      try { w.redeemPairCode(i % 2 ? 'ZZZ-ZZZ' : 'not a code'); } catch (e) { msgs.add((e as Error).message); }
    }
    expect([...msgs]).toEqual([PAIR_REFUSAL]);
    // the right code is refused too while the window is full: guesses per minute are bounded
    expect(() => w.redeemPairCode(code)).toThrow(PAIR_THROTTLED);
    run(w, 61);
    const again = w.mintPairCode(a.id).code;
    expect(w.redeemPairCode(again)).toBe(a);
  });

  it('a source over its own cap is refused without spending the realm budget: one address cannot lock everyone out', () => {
    const w = mk();
    const a = join(w, 'Alice');
    const { code } = w.mintPairCode(a.id);
    // one noisy address hammers away far past its cap ...
    for (let i = 0; i < PAIR_FAIL_PER_REALM_PER_MIN * 3; i++) {
      let msg = '';
      try { w.redeemPairCode('ZZZ-ZZZ', '203.0.113.9'); } catch (e) { msg = (e as Error).message; }
      expect(msg).toBe(i < PAIR_FAIL_PER_IP_PER_MIN ? PAIR_REFUSAL : PAIR_THROTTLED);
    }
    // ... and the player at home still pairs with the right code
    expect(w.redeemPairCode(code, '198.51.100.7')).toBe(a);
    // it takes PAIR_FAIL_PER_REALM_PER_MIN / PAIR_FAIL_PER_IP_PER_MIN addresses to fill the realm's window
    const sources = PAIR_FAIL_PER_REALM_PER_MIN / PAIR_FAIL_PER_IP_PER_MIN;
    expect(sources).toBe(3);
    for (let s = 1; s < sources; s++) for (let i = 0; i < PAIR_FAIL_PER_IP_PER_MIN; i++) expect(() => w.redeemPairCode('ZZZ-ZZZ', `10.0.0.${s}`)).toThrow(PAIR_REFUSAL);
    const second = w.mintPairCode(a.id).code;
    expect(() => w.redeemPairCode(second, '198.51.100.7')).toThrow(PAIR_THROTTLED);
    run(w, 61);
    expect(w.redeemPairCode(second, '203.0.113.9')).toBe(a); // the window clears for everyone
  });

  it('come from the OS CSPRNG: minting never moves the seeded world RNG', () => {
    const w1 = mk(), w2 = mk();
    const a1 = join(w1, 'Alice'), a2 = join(w2, 'Alice');
    for (let i = 0; i < 20; i++) w1.mintPairCode(a1.id);
    void a2;
    expect(w1.rand()).toBe(w2.rand());
  });

  it('never appear in public state, and a token never appears anywhere public', () => {
    const w = mk();
    const a = join(w, 'Alice'), b = join(w, 'Bob');
    const { code } = w.mintPairCode(a.id);
    w.say(a, 'I solemnly swear that I am up to no good');
    const seen = publicSurfaces(w, b) + publicSurfaces(w, a);
    expect(seen).not.toContain(code.replace('-', ''));
    expect(seen).not.toContain(code);
    for (const x of [a, b]) expect(seen).not.toContain(x.token);
  });

  it('no refusal ever echoes what was typed (a token pasted as a code stays out of the error)', () => {
    const w = mk();
    const a = join(w, 'Alice');
    for (const typed of [a.token, `2-${a.token}`, 'ABC-DEF']) {
      let msg = '';
      try { w.redeemPairCode(typed); } catch (e) { msg = (e as Error).message; }
      expect(msg).toBe(PAIR_REFUSAL);
    }
    expect(w.events.map((e) => e.text + (e.zh ?? '')).join()).not.toContain(a.token);
  });

  it('NPCs do not pair', () => {
    const w = mk();
    const n = join(w, 'Neville');
    n.npc = true;
    expect(() => w.mintPairCode(n.id)).toThrow(/NPC/);
  });
});

describe('the length of a code', () => {
  it('matches the constants', () => {
    const w = mk();
    const a = join(w, 'Alice');
    expect(w.mintPairCode(a.id).code.replace(/-/g, '')).toHaveLength(PAIR_LEN);
  });
});

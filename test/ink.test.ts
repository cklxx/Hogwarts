import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRICULUM } from '../src/lore/spells';
import { ELEMENTS } from '../src/shared/constants';
import { SHOP } from '../src/shared/shop';
import { ELEMENT_ICON, feedIcon, houseIcon, isLatin, itemIcon, spellIcon } from '../client/ink';

const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
const sprite = new Set([...html.matchAll(/<symbol id="i-([^"]+)"/g)].map((m) => m[1]));

describe('the ink set (client/ink.ts, index.html #ink)', () => {
  it('has a drawing for every icon the client names', () => {
    const named = new Set<string>();
    const files = [
      ...readdirSync(new URL('../client/', import.meta.url)).filter((f) => f.endsWith('.ts') || f.endsWith('.html')),
      ...readdirSync(new URL('../client/panels/', import.meta.url)).filter((f) => f.endsWith('.ts')).map((f) => `panels/${f}`),
    ];
    for (const f of files) {
      const src = readFileSync(new URL(`../client/${f}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/\bic\('([a-z0-9-]+)'/g)) named.add(m[1]);
      for (const m of src.matchAll(/href="#i-([a-z0-9-]+)"/g)) named.add(m[1]);
    }
    for (const c of CURRICULUM) named.add(spellIcon(c.name));
    for (const e of ELEMENTS) named.add(ELEMENT_ICON[e]);
    for (const s of SHOP) named.add(itemIcon(s.slot));
    for (const h of ['Gryffindor', 'Hufflepuff', 'Ravenclaw', 'Slytherin', '?']) named.add(houseIcon(h));
    for (const t of ['chat', 'combat', 'egg', 'decree', 'term', 'dark', 'owl', 'mystery']) named.add(feedIcon(t));
    expect([...named].filter((id) => !sprite.has(id))).toEqual([]);
  });
  it('gives every curriculum spell its own drawing, and a written spell one by what it does', () => {
    for (const c of CURRICULUM) expect(spellIcon(c.name), c.name).not.toBe('wand');
    expect(spellIcon('My Bolt', ['bolt'], '(bolt (or target aim) 14 :fire)')).toBe('fire');
    expect(spellIcon('群体冰冻', ['bolt'], '(each e (enemies 10) (bolt e 8 :ice))')).toBe('ice');
    expect(spellIcon('Zap', ['bolt'], '(bolt target 9)')).toBe('stupefy');
    expect(spellIcon('Guard', ['shield', 'heal'])).toBe('protego');
    expect(spellIcon('Birds', ['summon'], '(summon :birds 20)')).toBe('bird');
    expect(spellIcon('Unknown yet')).toBe('wand');
    expect(spellIcon('Says hi', [])).toBe('scroll');
  });
  it('keeps Chinese upright (only Latin names get the italic face)', () => {
    expect(isLatin('Smoke96')).toBe(true);
    expect(isLatin('Hermione Granger')).toBe(true);
    expect(isLatin('赫敏')).toBe(false);
    expect(isLatin('Luna 洛夫古德')).toBe(false);
  });
});

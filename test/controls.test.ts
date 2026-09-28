import { describe, expect, it } from 'vitest';
import { CURRICULUM } from '../src/lore/spells';
import { analyze } from '../src/runes/checker';
import { World, spellKind } from '../src/kernel/world';


describe('spell kinds (smart casting in the browser)', () => {
  it('classifies the standard curriculum', () => {
    const kind = Object.fromEntries(CURRICULUM.map((c) => [c.name, spellKind(analyze(c.source).effects)]));
    for (const n of ['Stupefy', 'Incendio', 'Expelliarmus', 'Glacius', 'Depulso', 'Petrificus Totalus', 'Bombarda', 'Reducto', 'Confringo']) expect(kind[n], n).toBe('harm');
    for (const n of ['Protego', 'Episkey', 'Ferula', 'Finite Incantatem', 'Rennervate', 'Vulnera Sanentur']) expect(kind[n], n).toBe('help');
    for (const n of ['Lumos', 'Tempus', 'Revelio', 'Serpensortia', 'Avis', 'Expecto Patronum', 'Point Me', 'Homenum Revelio', 'Apparition']) expect(kind[n], n).toBe('self');
  });
  it('a spell that both harms and helps aims at the foe', () => {
    expect(spellKind(['heal', 'bolt'])).toBe('harm');
    expect(spellKind([])).toBe('self');
  });
  it('privateState tells the client what each hotbar slot is for', () => {
    const w = new World();
    const { wizard } = w.enroll('Kind Tester');
    const bar = w.privateState(wizard.id).hotbar;
    expect(bar[0]).toMatchObject({ name: 'Stupefy', kind: 'harm' });
    expect(bar.find((s) => s?.name === 'Episkey')).toMatchObject({ kind: 'help' });
    expect(bar.find((s) => s?.name === 'Tempus')).toMatchObject({ kind: 'self' });
  });
});

describe('click-to-move (setGoal behind the goto message)', () => {
  it('walks toward the goal and WASD cancels the walk', () => {
    const w = new World();
    const { wizard } = w.enroll('Walker');
    w.touch(wizard.id);
    expect(w.setGoal(wizard.id, { x: 20, z: 10 })).toBeTruthy();
    const start = { ...wizard.pos };
    for (let i = 0; i < 20; i++) w.tick(0.05);
    expect(Math.hypot(wizard.pos.x - start.x, wizard.pos.z - start.z)).toBeGreaterThan(1);
    w.setInput(wizard.id, 1, 0);
    expect(wizard.goal).toBeNull();
  });
});

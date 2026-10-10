/** Bounded governance: a Minister may change at most three rule leaves, and every decree expires at term end. */
import type { Feature } from './feature.js';
import { applyPatch, defaultRulebook, type Rulebook } from './rulebook.js';
import type { World } from './world.js';

export const DECREE_BUDGET = 5;

export interface GovernanceState {
  active: { term: number; before: Rulebook; decree: number; minister: string } | null;
}

declare module './world.js' { interface World { governance: GovernanceState } }

export function decreeCost(changes: readonly string[]): number {
  return Math.max(1, changes.length);
}

export function expireDecree(world: World) {
  const a = world.governance.active;
  if (!a || a.term !== world.term.n) return false;
  const res = applyPatch(defaultRulebook(), a.before as unknown);
  const was = world.rules;
  world.rules = res.ok ? res.rulebook : defaultRulebook();
  world.governance.active = null;
  for (const w of world.wizards.values()) world.clampVitals(w);
  world.rulesChanged(was, null);
  world.emit('decree', `The term ends. Minister ${a.minister}'s decree expires and the previous Rulebook returns.`, {
    zh: `学期结束。部长 ${a.minister} 的法令到期，规则书恢复到法令前状态。`,
  });
  return true;
}

export const GOVERNANCE_FEATURE: Feature = {
  id: 'governance',
  init(world) { world.governance = { active: null }; },
  save: (world) => world.governance,
  load(world, data) {
    const d = data && typeof data === 'object' ? data as Partial<GovernanceState> : {};
    const a = d.active;
    world.governance = { active: a && typeof a.term === 'number' && a.before && typeof a.before === 'object' && typeof a.decree === 'number' && typeof a.minister === 'string' ? a : null };
  },
  rules(world, before, minister) {
    if (minister) {
      world.governance.active = { term: world.term.n, before, decree: world.decrees.length - 1, minister: minister.name };
    } else if (world.governance.active) {
      // A DA veto or expiry restored a prior Rulebook. The expired policy must not return later.
      world.governance.active = null;
    }
  },
  view: {
    key: 'governance',
    board(world) {
      const a = world.governance.active;
      return { decreeBudget: DECREE_BUDGET, activeDecree: a ? { term: a.term, minister: a.minister, expiresAtTermEnd: true } : null };
    },
    whoami(world, w) {
      const a = world.governance.active;
      return { budget: DECREE_BUDGET, available: w.decreeCharges, active: a ? { minister: a.minister, term: a.term, expiresAtTermEnd: true } : null };
    },
  },
};

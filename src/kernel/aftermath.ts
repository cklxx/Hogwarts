/**
 * 战后世界 Aftermath (Phase 2): Day 7 总攻之后，世界真实改变。
 *
 * - 存活名录：每个 NPC 的存活/阵亡，记在 world.flags.warweekAftermath
 * - 墓碑：阵亡 NPC 在倒下的位置留下墓碑（2D 客户端渲染，玩家走近看名字）
 * - 商店：命运链结果决定开关（merchant lost → 关门 1 学期；saved → 8 折）
 * - 下周目加成：命运链结果给下个周目开局 buff（如 snape saved → 全员 +30 XP）
 * - 阵亡 NPC 本周目及之后不再刷新（名字进 deadNames，ensureNpcs 跳过）
 *
 * 命运链接口约定（fates.ts 那边写，我这边读）：
 *   world.flags.fateResults: Record<chainId, 'saved' | 'lost'>
 *   chainId: 'hagrid' | 'merchant' | 'snape' | 'luna' | 'filch'
 * fates.ts 未加载时 fateResults 为空对象，所有链按 'lost' 处理（世界默认是残酷的）。
 */
import type { House } from '../shared/constants.js';
import type { World } from './world.js';

/** 命运链 id（与 fates.ts 约定一致）。 */
export type FateChainId = 'hagrid' | 'merchant' | 'snape' | 'luna' | 'filch';
export const FATE_CHAINS: readonly FateChainId[] = ['hagrid', 'merchant', 'snape', 'luna', 'filch'];

/** 一座墓碑：谁倒在这里。 */
export interface Tombstone { name: string; house: House; x: number; z: number; term: number }

/** 名录条目。 */
export interface RosterEntry { name: string; house: House; alive: boolean }

/** 下周目开局加成。 */
export interface CycleBuff { kind: 'xp'; amount: number; reason: string; reasonZh: string }

export interface AftermathState {
  /** 上次总攻的完整名录（快照，供战报和 HUD）。 */
  roster: RosterEntry[];
  /** 所有墓碑（跨周目累积，2D 渲染用）。 */
  tombstones: Tombstone[];
  /** 阵亡 NPC 的名字：ensureNpcs 跳过这些人。 */
  deadNames: string[];
  /** 商店关门到哪个学期（含）：world.term.n <= 该值时集市关闭。 */
  shopClosedUntilTerm: number;
  /** 商店折扣乘数：1 = 原价，0.8 = 八折。 */
  shopDiscount: number;
  /** 下周目 Day 1 发放的加成。 */
  pendingBuffs: CycleBuff[];
  /** 上次结算的胜负（战报摘要用）。 */
  lastWon: boolean;
  /** 上次结算时的学期。 */
  lastSettledTerm: number;
}

export const emptyAftermath = (): AftermathState => ({
  roster: [], tombstones: [], deadNames: [],
  shopClosedUntilTerm: 0, shopDiscount: 1, pendingBuffs: [],
  lastWon: false, lastSettledTerm: 0,
});

/** 读命运链结果：优先读 fates.ts 的 thread 状态（source of truth），回退到 flags.fateResults。 */
export function fateResult(world: World, id: FateChainId): 'saved' | 'lost' {
  const threads = (world as any).fates?.threads as Record<string, { state?: string }> | undefined;
  const s = threads?.[id]?.state;
  if (s === 'saved') return 'saved';
  if (s === 'lost') return 'lost';
  const r = (world.flags as any).fateResults as Record<string, string> | undefined;
  return r?.[id] === 'saved' ? 'saved' : 'lost';
}

/** 商店是否关门。 */
export function isShopClosed(world: World): boolean {
  const a = aftermathOf(world);
  return world.term.n <= a.shopClosedUntilTerm;
}

/** 当前商店价格乘数（含折扣）。 */
export function shopPriceMultiplier(world: World): number {
  return aftermathOf(world).shopDiscount;
}

/** 该 NPC 是否已阵亡（不再刷新）。 */
export function isNpcDead(world: World, name: string): boolean {
  return aftermathOf(world).deadNames.includes(name);
}

function aftermathOf(world: World): AftermathState {
  const f = world.flags as any;
  if (!f.warweekAftermath) f.warweekAftermath = emptyAftermath();
  return f.warweekAftermath as AftermathState;
}

/**
 * 总攻结算时调用：清点伤亡、立墓碑、按命运链定商店与下周目加成。
 * fallen: 总攻结束时倒下（stunned）的 NPC。
 */
export function buildAftermath(
  world: World,
  won: boolean,
  fallen: { name: string; house: House; x: number; z: number }[],
): AftermathState {
  const a = aftermathOf(world);
  const aliveNames = new Set(
    [...world.wizards.values()].filter((w) => w.npc && world.isActive(w)).map((w) => w.name),
  );
  const fallenNames = new Set(fallen.map((f) => f.name));

  // 名录：活着的 + 这次倒下的（去重）
  const seen = new Set<string>();
  a.roster = [];
  for (const w of world.wizards.values()) {
    if (!w.npc || seen.has(w.name)) continue;
    seen.add(w.name);
    a.roster.push({ name: w.name, house: w.house, alive: aliveNames.has(w.name) });
  }
  for (const f of fallen) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    a.roster.push({ name: f.name, house: f.house, alive: false });
  }

  // 墓碑 + 永久除名
  for (const f of fallen) {
    if (!a.deadNames.includes(f.name)) a.deadNames.push(f.name);
    if (!a.tombstones.some((t) => t.name === f.name)) {
      a.tombstones.push({ name: f.name, house: f.house, x: Math.round(f.x), z: Math.round(f.z), term: world.term.n });
    }
    // 从世界上移除：他死了
    const w = [...world.wizards.values()].find((x) => x.npc && x.name === f.name);
    if (w) world.wizards.delete(w.id);
  }

  // 商店：merchant 链
  if (fateResult(world, 'merchant') === 'lost') {
    a.shopClosedUntilTerm = world.term.n + 1; // 关门 1 学期
    a.shopDiscount = 1;
  } else {
    a.shopClosedUntilTerm = 0;
    a.shopDiscount = 0.8; // 救了商人：八折
  }

  // 下周目加成：snape 链
  a.pendingBuffs = [];
  if (fateResult(world, 'snape') === 'saved') {
    a.pendingBuffs.push({ kind: 'xp', amount: 30, reason: "Snape's draught", reasonZh: '斯内普的魔药' });
  }
  void fallenNames;

  a.lastWon = won;
  a.lastSettledTerm = world.term.n;
  return a;
}

/**
 * 新周目 Day 1 调用：广播上周目摘要，发放 pending buffs。
 * 返回 true 表示发过广播（调用方只在 Day 1 调一次）。
 */
export function applyCycleStart(world: World): boolean {
  const a = aftermathOf(world);
  if (a.lastSettledTerm === 0) return false; // 还没打过第一仗
  const dead = a.roster.filter((r) => !r.alive).map((r) => r.name);
  const parts: string[] = [];
  const partsZh: string[] = [];
  parts.push(a.lastWon ? 'Last week we held the castle.' : 'Last week the assault was not broken.');
  partsZh.push(a.lastWon ? '上周我们守住了城堡。' : '上周进攻没能被击退。');
  if (dead.length) {
    parts.push(`Fallen: ${dead.slice(0, 6).join(', ')}${dead.length > 6 ? ` (+${dead.length - 6} more)` : ''}. Their tombstones stand where they fell.`);
    partsZh.push(`阵亡：${dead.slice(0, 6).join('、')}${dead.length > 6 ? `（等 ${dead.length - 6} 人）` : ''}。墓碑立在他们倒下的地方。`);
  }
  if (isShopClosed(world)) {
    parts.push('The market is closed this term (the merchant was not saved).');
    partsZh.push('集市本学期关门（商人没能得救）。');
  } else if (a.shopDiscount < 1) {
    parts.push('The market honors its debt: 20% off this cycle.');
    partsZh.push('集市还记得那份人情：本周期八折。');
  }
  world.emit('term', `📜 ${parts.join(' ')}`, { zh: `📜 ${partsZh.join('')}` });

  // 发 buffs
  for (const b of a.pendingBuffs) {
    for (const w of world.wizards.values()) {
      if (w.npc || !world.online(w)) continue;
      if (b.kind === 'xp') {
        world.gainXp(w, b.amount);
        world.emit('achievement', `🧪 ${b.reason}: +${b.amount} XP to start the week.`, {
          to: w.id, zh: `🧪 ${b.reasonZh}：本周开局 +${b.amount} 经验。`,
        });
      }
    }
  }
  a.pendingBuffs = [];
  return true;
}

/** 2D 快照用：墓碑列表。 */
export function tombstonesOf(world: World): Tombstone[] {
  return aftermathOf(world).tombstones;
}

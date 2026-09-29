import { L } from '../i18n';
import type { DaView, FamiliarKind, FamiliarState, FocusView, Grade, StudyEntry } from './types';

/**
 * The pure parts of the browser panels (no DOM): directions, countdowns, the words for states. The modules next to
 * this one draw them; test/panels.test.ts walks them.
 */

/** Distance (m) and the screen rotation (rad) of an arrow from `from` to `to`, for a camera turned by `camYaw`. */
export function bearing(from: { x: number; z: number }, to: { x: number; z: number }, camYaw: number): { dist: number; rot: number } {
  const dx = to.x - from.x, dz = to.z - from.z;
  return { dist: Math.hypot(dx, dz), rot: Math.atan2(dx, -dz) + camYaw };
}

/** "2:05" (minutes:seconds). */
export const fmtClock = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

/** "123 米" / "1.2 公里". */
export function fmtDist(m: number): string {
  if (m >= 1000) return L(`${(m / 1000).toFixed(1)} 公里`, `${(m / 1000).toFixed(1)} km`);
  return L(`${Math.round(m)} 米`, `${Math.round(m)} m`);
}

// ------------------------------------------------------------------ 偷师
export const studyKey = (s: { handle: string; spell: string }) => `${s.handle}:${s.spell}`;
/** Seconds until a spell that hit you can be studied (0 = now), at world time `now`. */
export const readyIn = (s: StudyEntry, now: number) => Math.max(0, Math.ceil(s.readyAt - now));
/** The studyable spells ready at `now` that `told` has not announced yet (and marks them told). */
export function newlyReady(list: readonly StudyEntry[], now: number, told: Set<string>): StudyEntry[] {
  const out: StudyEntry[] = [];
  for (const s of list) {
    const k = studyKey(s);
    if (readyIn(s, now) > 0 || told.has(k)) continue;
    told.add(k);
    out.push(s);
  }
  return out;
}

// ------------------------------------------------------------------ 邓布利多军
export type VetoPhase = 'none' | 'open' | 'voted' | 'used';
/** Where the veto stands for you: no decree to veto, a window open (you have not voted / you have), or spent this term. */
export function vetoPhase(da: DaView | null | undefined): VetoPhase {
  if (!da) return 'none';
  if (da.veto.usedThisTerm) return 'used';
  if (!da.veto.decree) return 'none';
  return da.veto.voted ? 'voted' : 'open';
}
/** One line on whether you may join (the reply's own reason when you may not). */
export function daStanding(da: DaView | null | undefined): string {
  if (!da) return '';
  if (da.member) return L('你是邓布利多军的一员。', "You are in Dumbledore's Army.");
  if (da.eligible) return L('你可以加入：邓布利多军是弱者的联盟。', "You may join: Dumbledore's Army is for the underdogs.");
  return L(da.whyZh ?? '你现在不能加入。', da.why ?? 'You cannot join right now.');
}
/** Is the quorum there (members in play ≥ quorum)? */
export const quorumMet = (da: DaView) => da.online >= da.quorum;

// ------------------------------------------------------------------ 使魔
export const FAMILIAR_KINDS: { k: FamiliarKind; zh: string; en: string; icon: string }[] = [
  { k: 'owl', zh: '猫头鹰', en: 'Owl', icon: 'owl' },
  { k: 'cat', zh: '猫', en: 'Cat', icon: 'cat' },
  { k: 'toad', zh: '蟾蜍', en: 'Toad', icon: 'toad' },
];
export const familiarLabel = (k: FamiliarKind) => { const f = FAMILIAR_KINDS.find((x) => x.k === k) ?? FAMILIAR_KINDS[0]; return L(f.zh, f.en); };
/** The familiar's state in a few words. */
export function familiarStatus(f: FamiliarState): { tone: 'off' | 'on' | 'busy' | 'dormant' | 'tired'; text: string } {
  if (!f.on) return { tone: 'off', text: L('还没有召唤', 'not summoned') };
  if (f.dormant) return { tone: 'dormant', text: L('在打盹：你自己的 Agent 已连接（外部 Agent 优先）', 'napping: your own agent is connected (it comes first)') };
  if (f.queued > 0) return { tone: 'busy', text: L(`排队中：第 ${f.queued} 位`, `queued: #${f.queued}`) };
  if (f.busy) return { tone: 'busy', text: L('正在给你写回信……', 'writing back to you…') };
  if (f.left <= 0) return { tone: 'tired', text: L('今天累了，明天再来', 'worn out for today') };
  return { tone: 'on', text: L('在你身边：按 O 写信给它', 'at your side: press O to write to it') };
}
export const quotaText = (f: FamiliarState) => L(`今天还剩 ${f.left}/${f.daily} 次`, `${f.left}/${f.daily} requests left today`);

// ------------------------------------------------------------------ 专注力
/** How full the agent's concentration is (0..1) and whether it is running low. */
export function focusLevel(f: FocusView): { frac: number; low: boolean } {
  const frac = f.max > 0 ? Math.max(0, Math.min(1, f.cur / f.max)) : 0;
  return { frac, low: frac < 0.2 };
}
export const focusTip = (f: FocusView) => L(`Agent 专注力 ${f.cur}/${f.max}（每秒回复 ${f.regen}）：行动类工具会消耗它，用完要歇一歇`, `Agent concentration ${f.cur}/${f.max} (+${f.regen}/s): action tools spend it; when it runs out the agent must rest`);

// ------------------------------------------------------------------ O.W.L.
export const PASSING: ReadonlySet<Grade> = new Set(['O', 'E', 'A']);
export const GRADE_ZH: Record<Grade, string> = { O: '优秀', E: '良好', A: '及格', P: '差', D: '很差', T: '巨怪' };
export const GRADE_EN: Record<Grade, string> = { O: 'Outstanding', E: 'Exceeds Expectations', A: 'Acceptable', P: 'Poor', D: 'Dreadful', T: 'Troll' };
export const gradeName = (g: Grade) => L(GRADE_ZH[g], GRADE_EN[g]);
/** The Troll meme, for a T. */
export const TROLL_MEME = () => L('巨怪——在地下教室里！……我想你应该知道。', 'TROLL — in the dungeon! …Thought you ought to know.');
/** The lawless zone's HUD label. */
export const LAWLESS_LABEL = () => L('无规则区：诅咒冷却与次数上限失效，掉落与声望翻倍', 'Lawless zone: curse cooldowns and caps are off, loot and duel reputation doubled');

/** HTML-escape (panels build their markup as strings, like the rest of the HUD). */
export const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const CJK = /[⺀-鿿豈-﫿＀-￯]/;
/**
 * The kernel often says a thing twice in one string, "中文 English" or "English 中文" (exam reports, errors). Pick
 * the reader's half; a string that is not two halves comes back whole.
 */
export function pickLang(s: string, want: 'zh' | 'en'): string {
  const t = String(s ?? '').trim();
  if (!t) return t;
  const zhFirst = CJK.test(t[0]);
  for (let i = t.indexOf(' '); i > 0; i = t.indexOf(' ', i + 1)) {
    const a = t.slice(0, i).trim(), b = t.slice(i + 1).trim();
    if (!a || !b) continue;
    if (zhFirst ? !CJK.test(b) && CJK.test(a) : CJK.test(b[0]) && !CJK.test(a)) return (zhFirst ? want === 'zh' : want === 'en') ? a : b;
  }
  return t;
}

/**
 * 不公平，但好玩 — "unfair, but fun": strength is visible, it has counterplay, and the leader is worth hunting.
 * The words and small tables of the five mechanics (README "## 不公平，但好玩"); the state changes live in
 * World (updateDarkLord, stun, joinDA / vetoDecree, damage's joint bonus, noteSpellHit / studySpell,
 * guardHostileGift in the lawless zone, spendConcentration). Numbers: src/shared/constants.ts.
 */
import type { Line } from '../lore/memes.js';

// ------------------------------------------------------------------ 黑魔王 the Dark Lord
/** When the mark passes to someone ({name}; {old} the previous holder, or nobody). */
export const DARK_LORD_RISES: Line[] = [
  { zh: '☠ 黑魔标记升上了天空：{name} 成了黑魔王（声望第一）。大家都叫 TA「那个人」——击晕 TA 的人能夺走 30% 声望。', en: '☠ The Dark Mark rises: {name} is now the Dark Lord (reputation #1). You-Know-Who. Whoever stuns them steals 30% of their reputation.' },
  { zh: '☠ 「神秘人」换人了：{name} 登上声望榜首，成为黑魔王。不能说名字的那位，现在全城都在找。', en: '☠ There is a new He-Who-Must-Not-Be-Named: {name} tops the leaderboard. Everyone is hunting them now.' },
  { zh: '☠ {name} 成了黑魔王。「那个人回来了！」——预言家日报暂时不打算承认这件事。', en: '☠ {name} is the Dark Lord. "He\'s back!" — the Daily Prophet declines to comment.' },
];
/** The mark fades with nobody to take it. */
export const DARK_LORD_FADES: Line = { zh: '黑魔标记从 {name} 头顶消散了。暂时没有黑魔王。', en: 'The Dark Mark over {name} fades. For now there is no Dark Lord.' };
/** The periodic broadcast of where the Dark Lord is ({name}, {place}, {x}, {z}). */
export const DARK_MARK_SEEN: Line[] = [
  { zh: '☠ 黑魔标记悬在{place}上空：那个人——{name}——就在那里（{x}, {z}）。', en: '☠ The Dark Mark hangs over {place}: {name}, You-Know-Who, is there ({x}, {z}).' },
  { zh: '☠ 有人在{place}看见了「神秘人」{name}（{x}, {z}）。凤凰社，集合！', en: '☠ You-Know-Who ({name}) was seen at {place} ({x}, {z}). Order of the Phoenix, assemble!' },
  { zh: '☠ {name} 在{place}（{x}, {z}）。嘘——别直呼其名。', en: '☠ {name} is at {place} ({x}, {z}). Shh — do not say the name.' },
];
/** To the new Dark Lord, privately. */
export const DARK_LORD_YOU: Line = {
  zh: '你是黑魔王了：直接伤害 ×1.15，但你的位置每分钟向全服广播一次，被击晕会被夺走 30% 声望。缴械咒对你照样有效。',
  en: 'You are the Dark Lord: your spells hit 15% harder, but your whereabouts are announced every minute and a stun takes 30% of your reputation. Expelliarmus still works on you.',
};
/** The Dark Lord is stunned ({name} by {k}, {n} reputation stolen). */
export const DARK_LORD_FALLS: Line[] = [
  { zh: '⚡ {k} 击倒了黑魔王 {name}，夺走 {n} 点声望！「大难不死的男孩」又多了一个。', en: '⚡ {k} stunned the Dark Lord {name} and took {n} reputation! Another Boy Who Lived.' },
  { zh: '⚡ 黑魔王 {name} 被 {k} 击晕（声望 -{n}）。伏地魔：这不可能！', en: '⚡ The Dark Lord {name} falls to {k} (-{n} reputation). "This is not possible!"' },
];

// ------------------------------------------------------------------ 邓布利多军 Dumbledore's Army
export const DA_NAME = { zh: '邓布利多军', en: "Dumbledore's Army" };
export const DA_JOINED: Line = { zh: '🦌 你在有求必应屋里签下了名字：{name}，欢迎加入邓布利多军。低调点——乌姆里奇在找这张羊皮纸。', en: "🦌 You sign the parchment in the Room of Requirement: welcome to Dumbledore's Army, {name}. Keep it quiet — Umbridge is looking for that list." };
export const DA_MEMBER_JOINED: Line = { zh: '🦌 {name} 加入了邓布利多军。', en: "🦌 {name} joined Dumbledore's Army." };
export const DA_LEFT: Line = { zh: '你离开了邓布利多军。（羊皮纸上没有出现「告密生」三个字——你只是走了。）', en: "You left Dumbledore's Army. (No SNEAK appears on your face — you simply left.)" };
export const DA_OUTGROWN: Line = { zh: '{name} 成了{role}，名字从邓布利多军的羊皮纸上消失了。', en: "{name} became {role}; their name vanishes from Dumbledore's Army's parchment." };
export const DA_VETOED: Line = {
  zh: '⚡ 邓布利多军否决了部长 {minister} 的法令！规则书恢复原状，铜像也被推倒了。「我们是邓布利多军！」',
  en: "⚡ Dumbledore's Army has vetoed Minister {minister}'s decree! The Rulebook is restored and the statue toppled. \"We're Dumbledore's Army!\"",
};
export const DA_VOTE: Line = { zh: '🗳 你投票否决部长的法令（{v}/{need} 票，在线成员 {online}，法定人数 {q}）。', en: "🗳 You vote to veto the Minister's decree ({v}/{need} votes; {online} members online, quorum {q})." };
export const DA_JOINT: Line[] = [
  { zh: '🦌 呼神护卫！邓布利多军三杖齐发，这一击 ×1.25！', en: "🦌 Expecto Patronum! Dumbledore's Army strikes together (×1.25)!" },
  { zh: '🦌 「我们一起！」邓布利多军的守护神连成一片（伤害 ×1.25）。', en: '🦌 "Together!" The DA\'s Patronuses join into one (damage ×1.25).' },
];

// ------------------------------------------------------------------ 偷师 learning from the strong
export const STUDY_READY: Line = { zh: '原形立现：你看清了 {k} 的「{spell}」是怎么施的。用 study_spell 抄进你的咒语书（会署上原作者）。', en: "Revelio! You see how {k}'s \"{spell}\" works. study_spell copies it into your book (credited to its author)." };
export const STUDY_WAIT: Line = { zh: '原形立现：{k} 的「{spell}」还没看透，再挨几下、再等 {s} 秒。', en: 'Revelio! {k}\'s "{spell}" is not clear to you yet: {s}s more.' };
export const STUDIED_YOU: Line = { zh: '{v} 偷师了你的咒语「{spell}」。模仿是最真诚的恭维。', en: '{v} studied your spell "{spell}". Imitation is the sincerest form of flattery.' };

// ------------------------------------------------------------------ 无规则区 the lawless zone
export const LAWLESS_ENTER: Line = {
  zh: '⚠ 你走进了禁林深处：魔法部的法律到不了这里。包裹诅咒不再受冷却和 10 分钟上限限制，魔物掉落与决斗声望翻倍。新生、NPC、一年级依然受保护，血量底线与禁言上限也还在。想走随时可以走。',
  en: "⚠ You enter the Deep Forest: the Ministry's law does not reach here. Parcel curses skip their cooldowns and the 10-minute cap; creature loot and duel reputation are doubled. Newcomers, NPCs and first-years are still protected, and the health floor and silence caps still hold. You may leave at any time.",
};
export const LAWLESS_LEAVE: Line = { zh: '你走出了禁林深处，魔法部的保护重新生效。', en: "You leave the Deep Forest; the Ministry's protections apply again." };

// ------------------------------------------------------------------ 专注力 agent concentration
/**
 * What each MCP tool costs in concentration. Tools not listed (reading, talking to your human, waiting,
 * identity) are free; so is everything a browser sends.
 */
export const AGENT_TOOL_COST: Readonly<Record<string, number>> = {
  cast: 1, use_item: 1, move_to: 1, dodge: 1, say: 1, set_hotbar: 1, unlearn_spell: 1, equip_item: 1, unequip_item: 1, destroy_item: 1,
  forge_spell: 3, forge_item: 3, read_seal_page: 1, break_seal: 2, decree: 1,
  join_dumbledores_army: 1, leave_dumbledores_army: 1, veto_decree: 1, study_spell: 2,
  // 咒语集市 (kernel/market.ts): copying and forking forge a spell, so they cost what a forge does; browsing is free
  publish_spell: 2, unpublish_spell: 1, copy_spell: 3, fork_spell: 3,
  // 隐藏宝箱: opening one is an action (reading school_events and frog_cards is free)
  open_chest: 1,
  // 魁地奇: every op counts (a status poll too: one a second is about the regen)
  quidditch: 1,
};
export const tiredText = (cur: number, max: number, retry: number) =>
  `Your wand hand is tired (concentration ${cur}/${max}). Rest ${retry}s and try again. 你的持杖手累了（专注力 ${cur}/${max}），歇 ${retry} 秒再试。 retry_after=${retry}`;

/**
 * 聊天 (a Feature): five channels over the one event feed.
 *
 * - `all` — the whole school: World.say (the speech bubble, and the words that have power here);
 * - `house` — your house, wherever they are;
 * - `near` — whoever stands within CHAT_NEAR_M of you (a bubble over your head too);
 * - `dm` — a whisper to one wizard (by handle or name), seen by the two of you only;
 * - `da` — Dumbledore's Army, members only, across houses (playtest round 4: an organiser whispered each member in turn).
 *
 * A line is a 'chat' event with `ch` and, for the last three, `aud` (the registry ids it is delivered to: World
 * visibleTo; `aud` never goes on the wire). Silenced wizards cannot chat; a line carrying your own Owl Post key is
 * refused (never let it reach anyone); at most CHAT_BURST lines per CHAT_WINDOW_S per wizard. MCP `chat` sends
 * and reads (the lines you can see, newest last); the browser sends {t:'chat', text, ch?, to?}.
 */
import { z } from 'zod';
import { SILENCED } from './hex.js';
import type { Feature } from './feature.js';
import { isDaMember } from './unfair.js';
import { visibleTo, type WorldEvent } from './types.js';
import type { World } from './world.js';

export const CHAT_CHANNELS = ['all', 'house', 'near', 'dm', 'da'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
export const CHAT_NEAR_M = 30, CHAT_MAX = 200, CHAT_BURST = 6, CHAT_WINDOW_S = 10, CHAT_READ_MAX = 50;
const KEY_LEAK = 'That line contains your Owl Post key: not sent. Never write your key anywhere; if it has leaked, rotate it (Esc → Owl Post). 这句话里有你的猫头鹰邮递密钥：没有发出。别把密钥写在任何地方；如果泄露了，去换一把（Esc → 猫头鹰邮递）。';

declare module './world.js' {
  interface World {
    /** 聊天 (this module's Feature): when each wizard last spoke, for the burst limit. */
    chat: { recent: Map<string, number[]> };
  }
}

export interface ChatLine { id: number; t: number; ch: ChatChannel; text: string; zh?: string; private: boolean }

/** Send one line. Throws (bilingual) when it cannot go. */
export function chatSend(world: World, wid: string, a: { text?: unknown; ch?: unknown; to?: unknown }) {
  const w = world.need(wid);
  const ch: ChatChannel = CHAT_CHANNELS.includes(a.ch as ChatChannel) ? (a.ch as ChatChannel) : 'all';
  const text = String(a.text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
  if (!text) throw new Error('Say something. 说点什么。');
  if (w.token && text.includes(w.token)) throw new Error(KEY_LEAK);
  if (world.silenced(w)) throw new Error(SILENCED);
  const times = (world.chat.recent.get(wid) ?? []).filter((t) => world.now - t < CHAT_WINDOW_S);
  if (times.length >= CHAT_BURST) throw new Error(`Slow down: at most ${CHAT_BURST} lines every ${CHAT_WINDOW_S} s. 慢一点：每 ${CHAT_WINDOW_S} 秒最多 ${CHAT_BURST} 句。`);
  times.push(world.now);
  world.chat.recent.set(wid, times);
  if (ch === 'all') { world.say(w, text, w.npc ? 'npc' : 'chat'); return { sent: ch }; }
  let aud: string[], label: { en: string; zh: string };
  if (ch === 'house') {
    aud = [...world.wizards.values()].filter((x) => x.house === w.house).map((x) => x.id);
    label = { en: `[${w.house}]`, zh: '[学院]' };
  } else if (ch === 'da') {
    if (!isDaMember(world, w.id)) throw new Error("Only members of Dumbledore's Army hear the DA channel: join_dumbledores_army first. 只有邓布利多军成员能用这个频道。");
    aud = [...world.da.members];
    label = { en: '[D.A.]', zh: '[邓布利多军]' };
  } else if (ch === 'near') {
    aud = [...world.nearWizards(w.pos, CHAT_NEAR_M)].filter((x) => Math.hypot(x.pos.x - w.pos.x, x.pos.z - w.pos.z) <= CHAT_NEAR_M).map((x) => x.id);
    if (!aud.includes(w.id)) aud.push(w.id);
    w.say = { text, until: world.now + 5 };
    label = { en: '[near]', zh: '[附近]' };
  } else {
    const to = world.resolveTarget(typeof a.to === 'string' ? a.to : null, wid);
    const t = to ? world.wizards.get(to) : undefined;
    if (!t) throw new Error('Whisper to whom? Give a wizard\'s handle or name in `to`. 悄悄话发给谁？在 to 里写对方的名字或代号。');
    if (t.id === w.id) throw new Error('Whispering to yourself? 对自己说悄悄话？');
    aud = [w.id, t.id];
    label = { en: `[whisper → ${t.name}]`, zh: `[悄悄话 → ${t.name}]` };
  }
  world.emit('chat', `${label.en} ${w.name}: ${text}`, { who: [w.id], zh: `${label.zh} ${w.name}：${text}`, ch, aud });
  return { sent: ch, heardBy: aud.length - 1 };
}

/** The chat lines `wid` can see (newest last), optionally one channel, after an event id. */
export function chatRead(world: World, wid: string, a: { ch?: unknown; since?: unknown; limit?: unknown } = {}): ChatLine[] {
  const ch = CHAT_CHANNELS.includes(a.ch as ChatChannel) ? (a.ch as ChatChannel) : null;
  const since = typeof a.since === 'number' ? a.since : 0;
  const limit = Math.max(1, Math.min(CHAT_READ_MAX, typeof a.limit === 'number' ? Math.floor(a.limit) : 20));
  const line = (e: WorldEvent): ChatLine => ({ id: e.id, t: e.t, ch: e.ch ?? 'all', text: e.text, ...(e.zh ? { zh: e.zh } : {}), private: !!(e.to || e.aud) });
  return world.events.filter((e) => e.type === 'chat' && e.id > since && visibleTo(e, wid) && (!ch || (e.ch ?? 'all') === ch)).slice(-limit).map(line);
}

function run(world: World, wid: string, a: Record<string, unknown>) {
  return a.op === 'read' ? { lines: chatRead(world, wid, a) } : chatSend(world, wid, a);
}

export const CHAT_FEATURE: Feature = {
  id: 'chat',
  init(world) { world.chat = { recent: new Map() }; },
  tools: [{
    name: 'chat', title: 'Chat', cost: 1,
    description: `Talk to other players. op "send" (default): text (≤${CHAT_MAX}) on channel ch — "all" (the whole school, the same as say: some words have power), "house" (your house only), "near" (whoever is within ${CHAT_NEAR_M} m), "dm" (a whisper to one wizard: to = their handle or name; only the two of you see it), "da" (Dumbledore's Army members only, any house). op "read": the lines you can see, newest last (ch to filter, since = an event id, limit ≤ ${CHAT_READ_MAX}). At most ${CHAT_BURST} lines every ${CHAT_WINDOW_S} s. To talk privately to your own human, use tell_player instead. (聊天：全校 / 学院 / 附近 / 悄悄话 / 邓布利多军。)`,
    input: {
      op: z.enum(['send', 'read']).optional(), text: z.string().max(CHAT_MAX).optional(), ch: z.enum(CHAT_CHANNELS).optional(),
      to: z.string().max(40).optional(), since: z.number().int().optional(), limit: z.number().int().min(1).max(CHAT_READ_MAX).optional(),
    },
    run,
  }],
  ws: (world, wid, m) => chatSend(world, wid, m as Record<string, unknown>),
};

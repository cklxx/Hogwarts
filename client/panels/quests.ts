/**
 * 今日课表 in the browser (src/kernel/quests.ts): a slip above the chat log with today's three goals and how far
 * you are. Folded to its one line (📜 1/3) unless the pointer is on it, it was clicked open, or a lesson just moved
 * (then for OPEN_S): the quiet HUD, 2026-09-30. It asks the server on arrival, every QUEST_POLL_S, and whenever a
 * lesson is done.
 */
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { L, lang } from '../i18n';
import { esc } from './logic';

interface Lesson { id: string; zh: string; en: string; got: number; of: number; done: boolean }
const QUEST_POLL_S = 20;
/** A lesson that moved unfolds the slip this long. */
const OPEN_S = 6;

/** The slip's lines; pure, for tests. */
export function questLines(lessons: readonly Lesson[], zh: boolean) {
  return { done: lessons.filter((l) => l.done).length, of: lessons.length, rows: lessons.map((l) => ({ text: zh ? l.zh : l.en, n: `${Math.min(l.got, l.of)}/${l.of}`, done: l.done })) };
}

export const questsFeature: ClientFeatureFactory = (d, ctx): ClientFeature => {
  let lessons: Lesson[] = [], askedAt = -1e9, open = false, dirty = false, hover = false, until = 0, sig = '';
  ctx.keep('view', () => ({ lessons, open }), (s) => { lessons = s.lessons; open = s.open; dirty = true; }, 2);
  const el = document.createElement('div');
  el.id = 'quests';
  el.hidden = true;
  el.style.cssText = 'position:fixed;left:calc(16px * var(--u));bottom:calc(440px * var(--u));z-index:6;max-width:min(calc(340px * var(--u)),calc(100vw - 32px));padding:calc(6px * var(--u)) calc(10px * var(--u));background:rgb(var(--sheen2) / .9);color:var(--ink);border:1px solid var(--ink3);border-radius:calc(6px * var(--u));font-size:calc(14px * var(--t));cursor:pointer';
  el.addEventListener('click', () => { open = !open; dirty = true; });
  el.addEventListener('mouseenter', () => { hover = true; dirty = true; });
  el.addEventListener('mouseleave', () => { hover = false; dirty = true; });
  document.body.append(ctx.own(el));
  const ask = () => { askedAt = performance.now(); d.send({ t: 'quests' }); };
  function render() {
    dirty = false;
    if (!lessons.length) { el.hidden = true; return; }
    const q = questLines(lessons, lang === 'zh');
    el.hidden = false;
    const show = open || hover || performance.now() < until;
    el.innerHTML = `<b>📜 ${show ? `${L('今日课表', "Today's lessons")} ` : ''}${q.done}/${q.of}</b>${show ? q.rows.map((r) => `<div style="opacity:${r.done ? 0.55 : 1}">${r.done ? '✔' : '·'} ${esc(r.text)} <small>${r.n}</small></div>`).join('') : ''}`;
  }
  return {
    id: 'quests',
    widgets: [{ id: 'quests', zh: '今日课表', en: 'Today\'s lessons' }],
    hud() {
      if (performance.now() - askedAt > QUEST_POLL_S * 1000) ask();
      if (until && performance.now() > until) { until = 0; dirty = true; }
      if (dirty) render();
    },
    onEvent(e) { if (e.type === 'achievement' && e.text.startsWith('📜')) ask(); },
    onMessage(msg) {
      if (msg.t !== 'quests' || !msg.r) return false;
      lessons = (msg.r as { lessons: Lesson[] }).lessons ?? [];
      // a lesson moved (not the first answer): unfold for a moment
      const next = lessons.map((l) => l.got).join();
      if (sig && next !== sig) until = performance.now() + OPEN_S * 1000;
      sig = next;
      dirty = true;
      return true;
    },
  };
};

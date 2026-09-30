/**
 * 今日课表 in the browser (src/kernel/quests.ts): a slip above the chat log with today's three goals and how far
 * you are; click to fold. It asks the server on arrival, every QUEST_POLL_S, and whenever a lesson is done.
 */
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { L, lang } from '../i18n';
import { esc } from './logic';

interface Lesson { id: string; zh: string; en: string; got: number; of: number; done: boolean }
const QUEST_POLL_S = 20;

/** The slip's lines; pure, for tests. */
export function questLines(lessons: readonly Lesson[], zh: boolean) {
  return { done: lessons.filter((l) => l.done).length, of: lessons.length, rows: lessons.map((l) => ({ text: zh ? l.zh : l.en, n: `${Math.min(l.got, l.of)}/${l.of}`, done: l.done })) };
}

export const questsFeature: ClientFeatureFactory = (d): ClientFeature => {
  let lessons: Lesson[] = [], askedAt = -1e9, open = true, dirty = false;
  const el = document.createElement('div');
  el.id = 'quests';
  el.hidden = true;
  el.style.cssText = 'position:fixed;left:calc(16px * var(--u));bottom:calc(440px * var(--u));z-index:6;max-width:min(calc(340px * var(--u)),calc(100vw - 32px));padding:calc(6px * var(--u)) calc(10px * var(--u));background:rgb(var(--sheen2) / .9);color:var(--ink);border:1px solid var(--ink3);border-radius:calc(6px * var(--u));font-size:calc(14px * var(--t));cursor:pointer';
  el.addEventListener('click', () => { open = !open; dirty = true; });
  document.body.append(el);
  const ask = () => { askedAt = performance.now(); d.send({ t: 'quests' }); };
  function render() {
    dirty = false;
    if (!lessons.length) { el.hidden = true; return; }
    const q = questLines(lessons, lang === 'zh');
    el.hidden = false;
    el.innerHTML = `<b>📜 ${L('今日课表', "Today's lessons")} ${q.done}/${q.of}</b>${open ? q.rows.map((r) => `<div style="opacity:${r.done ? 0.55 : 1}">${r.done ? '✔' : '·'} ${esc(r.text)} <small>${r.n}</small></div>`).join('') : ''}`;
  }
  return {
    id: 'quests',
    widgets: [{ id: 'quests', zh: '今日课表', en: 'Today\'s lessons' }],
    hud() {
      if (performance.now() - askedAt > QUEST_POLL_S * 1000) ask();
      if (dirty) render();
    },
    onEvent(e) { if (e.type === 'achievement' && e.text.startsWith('📜')) ask(); },
    onMessage(msg) {
      if (msg.t !== 'quests' || !msg.r) return false;
      lessons = (msg.r as { lessons: Lesson[] }).lessons ?? [];
      dirty = true;
      return true;
    },
  };
};

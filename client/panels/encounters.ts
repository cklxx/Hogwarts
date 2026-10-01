/**
 * 遭遇 in the browser (src/shared/encounters.ts; the kernel's src/kernel/encounters.ts):
 *  - in an encounter's circle, one line at the top: its name, the goal and how far along (the tip under it for the
 *    first seconds there, and while you hover it);
 *  - when one is cleared, its doors in the middle of the screen (Hades' chambers): a new rune, a level on one, a purse —
 *    a click takes one. They stay until you do.
 */
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { L } from '../i18n';
import { doorText, encounterById, type Door } from '../../src/shared/encounters';
import { esc } from './logic';

interface Enc { here?: { id: string; n: number; need: number; done: boolean }; doors?: { enc: string; doors: Door[] } }
const ICON: Record<Door['t'], string> = { rune: '✨', level: '⬆', purse: '💰', study: '📖' };
/** The tip shows this long after you step in. */
const TIP_S = 8;

export const encountersFeature: ClientFeatureFactory = (d, ctx): ClientFeature => {
  const goal = ctx.el('div', 'encgoal', (el) => { el.hidden = true; document.body.append(el); });
  const doors = ctx.el('div', 'encdoors', (el) => { el.hidden = true; document.body.append(el); });
  doors.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-pick]') as HTMLButtonElement | null;
    if (!b) return;
    d.send({ t: 'encounters', pick: Number(b.dataset.pick) });
    doors.querySelectorAll('button').forEach((x) => { x.disabled = true; });
  });
  let goalSig = '', doorSig = '', inAt = 0, inId = '';
  return {
    id: 'encounters',
    widgets: [{ id: 'encgoal', zh: '遭遇目标', en: 'Encounter goal' }, { id: 'encdoors', zh: '遭遇奖励', en: 'Encounter rewards' }],
    hud() {
      const e = (d.me()?.enc ?? null) as Enc | null;
      const now = performance.now() / 1000;
      // the goal line
      const h = e?.here, def = h ? encounterById(h.id) : null;
      if (h && h.id !== inId) { inId = h.id; inAt = now; }
      if (!h) inId = '';
      const tip = !!def && !h!.done && now - inAt < TIP_S;
      const gs = def ? `${h!.id}|${h!.n}|${h!.done}|${tip}` : '';
      if (gs !== goalSig) {
        goalSig = gs;
        goal.hidden = !def;
        if (def) {
          goal.classList.toggle('done', h!.done);
          goal.title = L(def.tipZh, def.tipEn);
          goal.innerHTML = `<b>${esc(L(def.zh, def.en))}</b> ${h!.done ? L('本学期已完成 ✓', 'done this term ✓') : `${esc(L(def.goalZh, def.goalEn))} <span class="num">${Math.min(h!.n, h!.need)}/${h!.need}</span>`}`
            + (tip ? `<small>${esc(L(def.tipZh, def.tipEn))}</small>` : '');
        }
      }
      // the doors
      const q = e?.doors, ds = q ? JSON.stringify(q) : '';
      if (ds === doorSig) return;
      doorSig = ds;
      doors.hidden = !q;
      if (!q) return;
      const en = encounterById(q.enc);
      doors.innerHTML = `<b>✨ ${esc(L(`${en?.zh ?? ''}完成！挑一份`, `${en?.en ?? ''}: done! Take one`))}</b><div class="ed-row">`
        + q.doors.map((x, i) => {
          // (a door's line is 'what: how much' — the name big, the rest under it)
          const t = L(doorText(x).zh, doorText(x).en), k = t.search(/[：:]/), head = k > 0 ? t.slice(0, k) : t, rest = k > 0 ? t.slice(k + 1).trim() : '';
          return `<button data-pick="${i}" class="ed-${x.t}"><i>${ICON[x.t]}</i><b>${esc(head)}</b>${rest ? `<span>${esc(rest)}</span>` : ''}</button>`;
        }).join('') + '</div>';
    },
    onMessage(msg) { return msg.t === 'encounters'; },
  };
};

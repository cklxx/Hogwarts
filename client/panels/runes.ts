/**
 * 符文零件 in the browser (src/shared/runes.ts; the kernel's src/kernel/runes.ts): a rune you own that is on no spell
 * shows a card over the hotbar — what it does, the line of Runes it is worth, and one button per attack spell on your
 * bar — until it is on one (docs/DESIGN.md §4: every new player puts their first rune on a spell; the card is that
 * step, and it does not go away by itself). A hotbar tile whose spell carries a rune shows the rune's first character (its ::before; ::after is the selection ring).
 */
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { L, spellName } from '../i18n';
import { RUNES, type RuneId } from '../../src/shared/runes';
import { esc } from './logic';

interface Mine { bag: RuneId[]; on: Record<string, RuneId> }
interface Slot { id: string; name: string; kind?: string }

/** The rune waiting for a spell (the first owned and on none), or null. Pure, for tests. */
export function waiting(r: Mine | null | undefined): RuneId | null {
  if (!r) return null;
  const on = new Set(Object.values(r.on));
  return r.bag.find((k) => !on.has(k)) ?? null;
}

export const runesFeature: ClientFeatureFactory = (d, ctx): ClientFeature => {
  const card = ctx.el('div', 'runecard', (el) => { el.hidden = true; document.body.append(el); });
  card.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-spell]') as HTMLButtonElement | null;
    if (!b) return;
    d.send({ t: 'runes', rune: card.dataset.rune, spell: b.dataset.spell });
    b.disabled = true;
  });
  let sig = '';
  // the tiles' marks are on the hotbar (main.ts owns it): taken off again if this feature goes
  ctx.effect(() => () => { document.querySelectorAll('#hotbar > div[data-rune]').forEach((t) => t.removeAttribute('data-rune')); });
  return {
    id: 'runes',
    widgets: [{ id: 'runecard', zh: '符文', en: 'Runes' }],
    hud() {
      const me = d.me();
      const r = (me?.runes ?? null) as Mine | null;
      const bar = ((me?.hotbar ?? []) as (Slot | null)[]);
      // the tiles
      const tiles = document.querySelectorAll('#hotbar > div');
      bar.forEach((s, i) => {
        const t = tiles[i] as HTMLElement | undefined;
        if (!t) return;
        const k = s && r?.on[s.id];
        const mark = k ? L(RUNES[k].zh.slice(0, 1), RUNES[k].en.slice(0, 1)) : '';
        if ((t.dataset.rune ?? '') !== mark) { if (mark) t.dataset.rune = mark; else t.removeAttribute('data-rune'); }
      });
      // the card
      const k = waiting(r);
      const attacks = bar.filter((s): s is Slot => !!s && s.kind === 'harm');
      const next = k ? `${k}|${attacks.map((s) => s.id).join()}` : '';
      if (next === sig) return;
      sig = next;
      card.hidden = !k;
      if (!k) return;
      const def = RUNES[k];
      card.dataset.rune = k;
      card.innerHTML = `<b>✨ ${L(`新符文：${def.zh}`, `New rune: ${def.en}`)}</b><div>${esc(L(def.docZh, def.docEn))}</div>`
        + `<code>${L('相当于在咒语里写：', 'worth this in Runes: ')}${esc(def.code)}</code>`
        + `<div class="rc-row">${attacks.map((s) => `<button data-spell="${esc(s.id)}">${L(`装到「${esc(spellName(s.name))}」`, `Put on ${esc(s.name)}`)}</button>`).join('')}</div>`;
    },
    onMessage(msg) { return msg.t === 'runes'; },
  };
};

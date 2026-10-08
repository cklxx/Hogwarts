/**
 * 符文零件 in the browser (src/shared/runes.ts; the kernel's src/kernel/runes.ts): a rune you own that is on no spell
 * shows a card over the hotbar — what it does, an illustrative effect sketch, and one button per attack spell on your
 * bar — until it is on one (docs/DESIGN.md §4: every new player puts their first rune on a spell; the card is that
 * step, and it does not go away by itself). A hotbar tile whose spell carries a rune shows the rune's first character
 * and its level above 1 (its ::before; ::after is the selection ring).
 */
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { L, spellName } from '../i18n';
import { RUNES, type RuneId } from '../../src/shared/runes';
import { esc } from './logic';

interface Mine { bag: RuneId[]; on: Record<string, RuneId>; lv?: Partial<Record<RuneId, number>> }
interface Slot { id: string; name: string; kind?: string }

/** The rune waiting for a spell (the first owned and on none), or null. Pure, for tests. */
export function waiting(r: Mine | null | undefined): RuneId | null {
  if (!r) return null;
  const on = new Set(Object.values(r.on));
  return r.bag.find((k) => !on.has(k)) ?? null;
}

export const runesFeature: ClientFeatureFactory = (d, ctx): ClientFeature => {
  const card = ctx.el('div', 'runecard', (el) => { el.hidden = true; document.body.append(el); });
  let codeOpen = false;
  ctx.keep('code-open', () => codeOpen, (s) => { codeOpen = s; });
  // Reserve only the card's real height. No layout reads in the HUD's 10 Hz update.
  ctx.effect(() => {
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--runecard-h', `${card.hidden ? 0 : Math.ceil(card.getBoundingClientRect().height)}px`);
    });
    ro.observe(card);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--runecard-h'); };
  });
  card.addEventListener('click', (e) => {
    const toggle = (e.target as HTMLElement).closest('button[data-code]');
    if (toggle) {
      codeOpen = !codeOpen;
      toggle.setAttribute('aria-expanded', String(codeOpen));
      card.querySelector<HTMLElement>('#runecard-code')!.hidden = !codeOpen;
      return;
    }
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
        const lv = k ? r?.lv?.[k] ?? 1 : 1;
        const mark = k ? L(RUNES[k].zh.slice(0, 1), RUNES[k].en.slice(0, 1)) + (lv > 1 ? String(lv) : '') : '';
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
      card.innerHTML = `<div class="rc-head"><b>✨ ${L(`新符文：${def.zh}`, `New rune: ${def.en}`)}</b>`
        + `<button type="button" data-code aria-controls="runecard-code" aria-expanded="${codeOpen}">${L('效果示意', 'Effect sketch')}</button></div>`
        + `<div class="rc-doc">${esc(L(def.docZh, def.docEn))}</div>`
        + `<code id="runecard-code"${codeOpen ? '' : ' hidden'}>${L('示意，不能直接运行；获得符文后即可装备：', 'Illustration, not executable; equip the rune once owned: ')}${esc(def.code)}</code>`
        + `<div class="rc-row">${attacks.map((s) => {
          const label = esc(L(`装到「${spellName(s.name)}」`, `Put on ${s.name}`));
          return `<button type="button" data-spell="${esc(s.id)}" aria-label="${label}" title="${label}"><span class="rc-full">${label}</span><span class="rc-short" aria-hidden="true">${L('装 ', 'Equip ')}${esc(spellName(s.name))}</span></button>`;
        }).join('') || `<span class="hint">${L('先把攻击咒语放到快捷栏，就能装备符文', 'Add an attack spell to your hotbar to equip this rune')}</span>`}</div>`;
    },
    onMessage(msg) { return msg.t === 'runes'; },
  };
};

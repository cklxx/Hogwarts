import { L } from '../i18n';
import { ic } from '../ink';
import { FAMILIAR_KINDS, esc, familiarLabel, familiarStatus, quotaText } from './logic';
import type { FamiliarKind, FamiliarState } from './types';

/**
 * 召唤使魔: the built-in agent's control (README 使魔), drawn in the Owl panel (O) and the Owl Post (Esc). The
 * server says whether it has familiars at all: welcome.familiar is there, or not; a {t:'familiar'} that comes
 * back as "not available" also switches it off. Without them the control is simply not drawn.
 */
export function createFamiliar(d: { send: (o: unknown) => void; state: () => FamiliarState | null; mark: () => void }) {
  /** null: not known yet; false: this server has no familiars. */
  let available: boolean | null = null;
  let pick: FamiliarKind = 'owl';
  let msg = '';
  let asked = -1e9;
  /** The reply to our last summon/dismiss, until `me` catches up. */
  let replied: FamiliarState | null = null;

  const current = () => d.state() ?? replied;
  function html(where: 'owl' | 'menu'): string {
    if (available !== true) return '';
    const f = current();
    const st = f ? familiarStatus(f) : { tone: 'off' as const, text: '' };
    const on = !!f?.on;
    const kinds = FAMILIAR_KINDS.map((k) => `<button type="button" class="fam-k${(on ? f!.kind : pick) === k.k ? ' on' : ''}" data-fam-kind="${k.k}"${on ? ' disabled' : ''} aria-pressed="${(on ? f!.kind : pick) === k.k}">${ic(k.icon)}<span>${L(k.zh, k.en)}</span></button>`).join('');
    const head = `<div class="fam-h">${ic(on ? FAMILIAR_KINDS.find((k) => k.k === f!.kind)?.icon ?? 'owl' : 'owl')}<b>${L('使魔', 'Familiar')}</b><small>${L('内置 Agent：不用自己的 Agent，也能让它帮你写咒语', 'a built-in agent: writes spells for you, no agent of your own needed')}</small></div>`;
    const body = on
      ? `<p class="fam-st ${st.tone}"><i class="dot ${st.tone === 'on' ? 'on' : st.tone === 'dormant' ? 'paused' : ''}"></i>${L(`使魔 · ${familiarLabel(f!.kind)}`, `Familiar · ${familiarLabel(f!.kind)}`)}：${st.text}</p>
         <p class="fam-q hint">${quotaText(f!)}${where === 'menu' ? L(' · 在猫头鹰面板（O）里写信给它', ' · write to it in the Owl panel (O)') : L(' · 写一句「给我一个能冻住身边小精灵的咒语」试试', ' · try "give me a spell that freezes the pixies around me"')}</p>
         <div class="fam-row">${kinds}<button type="button" class="ghost" data-fam="off">${L('解散', 'Dismiss')}</button></div>`
      : `<div class="fam-row">${kinds}<button type="button" data-fam="on">${L('召唤使魔', 'Summon a familiar')}</button></div>
         <p class="fam-q hint">${f ? quotaText(f) + ' · ' : ''}${L('你自己的 Agent 一连上，使魔就退下打盹。', 'When your own agent connects, the familiar naps.')}</p>`;
    return `<div class="fam ${on ? 'is-on' : ''}">${head}${body}${msg ? `<p class="fam-msg err">${esc(msg)}</p>` : ''}</div>`;
  }
  function click(t: HTMLElement): boolean {
    const k = t.closest('[data-fam-kind]') as HTMLButtonElement | null;
    if (k && !k.disabled) { pick = k.dataset.famKind as FamiliarKind; return true; }
    const b = t.closest('[data-fam]') as HTMLButtonElement | null;
    if (!b || b.disabled) return false;
    if (performance.now() - asked < 800) return true;
    asked = performance.now();
    msg = '';
    d.mark();
    d.send({ t: 'familiar', on: b.dataset.fam === 'on', kind: pick });
    return true;
  }
  return {
    html, click,
    /** welcome: the server has familiars when it sends welcome.familiar. */
    onWelcome(f: FamiliarState | undefined) { available = !!f; if (f) { replied = f; pick = f.kind; } },
    onReply(f: FamiliarState) { available = true; replied = f; msg = ''; },
    /** An error right after a summon: "not available" hides the control; anything else is said under it. */
    onError(text: string): boolean {
      if (performance.now() - asked > 3000) return false;
      if (/not available/i.test(text)) available = false;
      else msg = text;
      return true;
    },
    get available() { return available === true; },
    /** What the state looks like (redraw when it changes). */
    sig: () => `${available}|${JSON.stringify(current())}|${pick}|${msg}`,
  };
}

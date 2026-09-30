import type { ClientFeatureFactory } from '../feature';
import { L, lang } from '../i18n';
import { ic } from '../ink';
import { errHalf, esc, newlyReady, readyIn, studyKey } from './logic';
import type { StudyEntry } from './types';

/**
 * 偷师: a custom spell of another wizard that hit you can be studied 120 s after it first did (me.studyable).
 * When one becomes ready a slip says so (under the clock); the spellbook's left page lists them all — who hit you
 * with what, ready now or in N s — with 「看源码」 (read it into the editor: that spends this spell's one study) and
 * 「抄进咒语书」 (forged into your book, credited to its author).
 */
export interface StudyDeps {
  /** The feature's context (client/context.ts) takes the elements this makes: gone when the feature is reloaded. */
  own?: <T extends Element>(el: T) => T;
  /** …and its listener on the document and its timers (tests leave them out). */
  on?: (t: EventTarget, type: string, fn: (e: Event) => void) => void;
  timeout?: (fn: () => void, ms: number) => unknown;
  send: (o: unknown) => void;
  list: () => StudyEntry[];
  now: () => number;
  spells: () => { name: string }[];
  openBook: () => void;
  loadDraft: (name: string, source: string, note: string) => void;
  toast: (t: string) => void;
  mark: () => void;
}

export function createStudy(d: StudyDeps) {
  const told = new Set<string>();
  let primed = false;
  let slip: StudyEntry | null = null;
  let slipUntil = 0;
  /** The request in flight: a copy or a read, and whether the book was closed when it was asked (from the slip). */
  let asked: { copy: boolean; open: boolean } | null = null;
  let lastBlock = '', lastSlip = '';
  /** 看源码 spends the spell's only study (kernel rule): the first click arms it, a second within 4 s reads. */
  let armed: { spell: string; from: string; until: number } | null = null;

  function act(spell: string, handle: string, copy: boolean) {
    const taken = d.spells().some((s) => s.name.toLowerCase() === spell.toLowerCase());
    asked = { copy, open: !!document.getElementById('book')?.hidden };
    d.mark();
    d.send({ t: 'study', spell, from: handle, ...(copy ? { copy: true, ...(taken ? { name: `${spell} (${L('偷师', 'studied')})` } : {}) } : {}) });
  }
  const buttons = (s: StudyEntry, now: number) => {
    const wait = readyIn(s, now);
    const dis = wait > 0 ? ` disabled title="${esc(L(`还要看 ${wait} 秒才能看透`, `${wait}s more before you see how it works`))}"` : '';
    const sure = armed && armed.spell === s.spell && armed.from === s.handle && performance.now() < armed.until;
    return `<button type="button" class="${sure ? 'warn' : 'ghost'}" data-study="read" data-spell="${esc(s.spell)}" data-from="${esc(s.handle)}"${dis} title="${esc(L('把源码读进编辑器（每个咒语只能偷师一次）', 'Read its source into the editor (each spell can be studied once)'))}">${ic('eye')}${sure ? L('再点一次：用掉这次偷师', 'Click again: spends the one study') : L('看源码', 'Read the source')}</button>`
      + `<button type="button" data-study="copy" data-spell="${esc(s.spell)}" data-from="${esc(s.handle)}"${dis} title="${esc(L('按你自己的年级上限铸造进咒语书，署上原作者', 'Forged into your book at your own year, credited to its author'))}">${ic('scroll')}${L('抄进咒语书', 'Copy into my book')}</button>`;
  };

  /** The block on the spellbook's left page (above the hotbar strip). */
  function renderBlock() {
    const bar = document.getElementById('book-bar');
    if (!bar || document.getElementById('book')?.hidden) return;
    let b = document.getElementById('book-study');
    if (!b) { b = document.createElement('div'); b.id = 'book-study'; bar.before(b); d.own?.(b); }
    const now = d.now(), list = d.list();
    const html = list.length
      ? `<h4>${ic('eye')}${L('偷师', 'Study')} <small>${L('被别人的自创咒语打中后 120 秒，就能看透它', '120 s after another wizard\'s own spell hits you, you can see how it works')}</small></h4><ul>`
        + list.map((s) => { const w = readyIn(s, now); return `<li><span class="st-t"><b>「${esc(s.spell)}」</b><small>${L(`${esc(s.from)} 用它打中了你`, `${esc(s.from)} hit you with it`)} · ${w > 0 ? L(`还要 <span class="num">${w}</span> 秒`, `ready in <span class="num">${w}</span>s`) : `<span class="ready">${L('可以偷师了', 'ready')}</span>`}</small></span><span class="st-a">${buttons(s, now)}</span></li>`; }).join('') + '</ul>'
      : '';
    if (html !== lastBlock) { b.innerHTML = html; lastBlock = html; }
    b.hidden = !html;
  }

  /** The slip under the clock when a spell becomes ready. */
  function renderSlip() {
    let el = document.getElementById('studyslip');
    if (!el) {
      const clock = document.getElementById('clock');
      if (!clock) return;
      el = document.createElement('div');
      el.id = 'studyslip';
      el.hidden = true;
      clock.after(el);
      d.own?.(el);
    }
    if (!slip || performance.now() > slipUntil) { el.hidden = true; slip = null; lastSlip = ''; return; }
    const html = `<div class="ss-h">${ic('eye')}<b>${L('偷师', 'Study')}</b><button type="button" class="x" data-study="close" aria-label="×"><svg class="ic"><use href="#i-x"/></svg></button></div>`
      + `<p>${L(`你看透了 <b>${esc(slip.from)}</b> 的「${esc(slip.spell)}」是怎么施的。`, `You see how <b>${esc(slip.from)}</b>'s "${esc(slip.spell)}" works.`)}</p><div class="ss-a">${buttons(slip, d.now())}</div>`;
    if (html !== lastSlip) { el.innerHTML = html; lastSlip = html; }
    el.hidden = false;
  }

  function update() {
    const list = d.list(), now = d.now();
    // what was ready before this page loaded is listed, not announced
    const fresh = newlyReady(list, now, told);
    if (!primed) { primed = true; } else if (fresh.length) { slip = fresh[0]; slipUntil = performance.now() + 30000; }
    if (slip && !list.some((s) => studyKey(s) === studyKey(slip!))) slip = null;
    renderBlock();
    renderSlip();
  }

  (d.on ?? ((t, k, f) => t.addEventListener(k, f)))(document, 'click', (e: Event) => {
    const b = (e.target as HTMLElement).closest('[data-study]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    if (b.dataset.study === 'close') { slip = null; renderSlip(); return; }
    const spell = b.dataset.spell ?? '', from = b.dataset.from ?? '';
    if (b.dataset.study === 'read' && !(armed && armed.spell === spell && armed.from === from && performance.now() < armed.until)) {
      armed = { spell, from, until: performance.now() + 4000 };
      update();
      (d.timeout ?? setTimeout)(update, 4100);
      return;
    }
    armed = null;
    act(b.dataset.spell ?? '', b.dataset.from ?? '', b.dataset.study === 'copy');
    slip = null;
    renderSlip();
  });

  return {
    update,
    onReply(r: { studied: string; author: string; source: string; copied?: { name: string } }) {
      if (r.copied) {
        d.toast(L(`✓ 「${r.copied.name}」抄进了你的咒语书（署名 ${r.author}）。`, `✓ "${r.copied.name}" is in your book, credited to ${r.author}.`));
      } else {
        // asked from the slip: open the book on it; asked from the book: only if it is still open (never pull it back up)
        if (asked?.open) d.openBook();
        if (!document.getElementById('book')?.hidden) d.loadDraft(`${r.studied}`, r.source, L(`偷师：${r.author} 的「${r.studied}」。改一改、用新名字铸造就是你的了（或者直接铸造，名字相同会被拒绝）。`, `Studied: ${r.author}'s "${r.studied}". Change it and forge it under a new name to make it yours.`));
        else d.toast(L(`偷师：你读到了 ${r.author} 的「${r.studied}」的源码（按 B 在咒语书里看）。`, `Studied ${r.author}'s "${r.studied}" (B shows it in the spellbook).`));
      }
      asked = null;
    },
    onError(text: string) { if (!asked) return false; asked = null; d.toast(text); return true; },
  };
}

/** 偷师 as a client feature (client/features.ts; src/kernel/unfair.ts STUDY_FEATURE). */
export const studyFeature: ClientFeatureFactory = (d, ctx) => {
  let asked = -1e9;
  const study = createStudy({ own: (el) => ctx.own(el), on: (t, k, f) => { ctx.on(t, k, f); }, timeout: (f, ms) => ctx.timeout(f, ms),
    send: d.send, list: () => (d.me()?.studyable as StudyEntry[] | undefined) ?? [], now: d.now, spells: d.spells,
    openBook: d.openBook, loadDraft: d.loadDraft, toast: d.toast, mark: () => { asked = performance.now(); },
  });
  return {
    id: 'study',
    widgets: [{ id: 'studyslip', zh: '偷师', en: 'Study' }],
    hud() { if (d.me()) study.update(); },
    onMessage(msg) {
      if (msg.t !== 'study') return false;
      const r = msg.r as Parameters<typeof study.onReply>[0];
      study.onReply(r);
      if (r.copied) d.send({ t: 'book' }); // the copy is in your book now
      return true;
    },
    onError: (text) => performance.now() - asked < 3000 && study.onError(errHalf(text, lang)),
  };
};

import { L, lang } from '../i18n';
import { ic } from '../ink';
import { createExams } from './exams';
import { createFamiliar } from './familiar';
import { errHalf, esc, focusLevel, focusTip } from './logic';
import type { ExamBoard, ExamList, FamiliarState, FocusView, SitReport } from './types';

export type { FamiliarState, FocusView } from './types';

/**
 * The panels for what the kernel already does but the browser did not show (docs/TODO.md 第二波 界面面板): the
 * O.W.L. exams (K), the familiar and the agent's concentration. main.ts hands over what it knows (PanelDeps) and
 * routes messages here; everything is drawn in the one parchment component (.sheet, the ink set). (The Dark Lord,
 * Dumbledore's Army, 偷师, the lawless zone and the Restricted Section are client features: client/features.ts.)
 */
export interface PMe {
  handle: string; name: string; year: number; reputation: number;
  focus?: FocusView | null;
  agent?: { familiar?: FamiliarState | null } | null;
}
export interface PanelDeps {
  send: (o: unknown) => void;
  me: () => PMe | null;
  agentConnected: () => boolean;
  spells: () => { id: string; name: string; builtin: boolean; source: string }[];
  wantSpells: () => void;
  solo: (el: HTMLElement) => void;
}

const $ = (id: string) => document.getElementById(id);
/** An element of the HUD this module owns, made on first use. */
function slot(id: string, make: () => HTMLElement): HTMLElement {
  let el = $(id);
  if (!el) { el = make(); el.id = id; }
  return el;
}

export function createPanels(d: PanelDeps) {
  /** When each panel last asked the server for something: an 'err' right after belongs to it. */
  const asked = { exams: -1e9, fam: -1e9 };
  const mark = (k: keyof typeof asked) => () => { asked[k] = performance.now(); };
  const recent = (k: keyof typeof asked) => performance.now() - asked[k] < 3000;

  const exams = createExams({ send: d.send, solo: d.solo, mark: mark('exams'), spells: d.spells, wantSpells: d.wantSpells });
  const fam = createFamiliar({ send: d.send, state: () => d.me()?.agent?.familiar ?? null, mark: mark('fam') });

  // ------------------------------------------------------------------ the HUD pieces

  /** The agent's concentration: a small ink tube beside the owl glyph, only with an agent connected and the rule on. */
  function focus() {
    const glyph = document.querySelector('#agentbox .ab-glyph') as HTMLElement | null;
    if (!glyph) return;
    let m = glyph.parentElement!.querySelector('.ab-focus') as HTMLElement | null;
    const f = d.me()?.focus;
    const show = !!f?.on && d.agentConnected();
    if (!show) { if (m) m.hidden = true; return; }
    if (!m) { m = document.createElement('span'); m.className = 'ab-focus'; m.innerHTML = '<i></i>'; glyph.after(m); }
    const { frac, low } = focusLevel(f!);
    const h = `${Math.round(frac * 100)}%`;
    const i = m.firstElementChild as HTMLElement;
    if (i.style.height !== h) i.style.height = h;
    m.classList.toggle('low', low);
    const tip = focusTip(f!);
    if (m.dataset.tip !== tip) { m.dataset.tip = tip; m.setAttribute('aria-label', tip); }
    m.hidden = false;
  }

  function familiarSpots() {
    const sig = fam.sig();
    const owl = $('owl'), who = $('owl-who');
    if (owl && who) {
      const box = slot('owl-fam', () => { const e = document.createElement('div'); who.after(e); return e; });
      if (box.dataset.sig !== sig) { box.innerHTML = fam.html('owl'); box.dataset.sig = sig; }
      box.hidden = !fam.available;
    }
    const op = $('op-fam');
    if (op && op.dataset.sig !== sig) { op.innerHTML = fam.html('menu'); op.dataset.sig = sig; }
    if (op) op.hidden = !fam.available;
  }
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-fam], [data-fam-kind]')) { if (fam.click(t)) familiarSpots(); return; }
    if (t.closest('[data-pn="exams"]')) { exams.toggle(true); return; }
  });

  return {
    /** 10 Hz, from main.ts' hud(). */
    hud() {
      if (!d.me()) return;
      focus();
      familiarSpots();
    },
    /** A server message for the panels; true when it was one. */
    onMessage(msg: { t: string; [k: string]: unknown }): boolean {
      switch (msg.t) {
        case 'welcome': fam.onWelcome(msg.familiar as FamiliarState | undefined); exams.refresh(); return false;
        case 'exams': exams.onList(msg.r as ExamList); return true;
        case 'sat': exams.onSat(msg.r as SitReport); return true;
        case 'examboard': { const r = msg.r as ExamBoard; if (r?.id) exams.onBoard(r); return true; }
        case 'familiar': fam.onReply(msg.s as FamiliarState); familiarSpots(); return true;
      }
      return false;
    },
    /** An 'err' the panels asked for (already translated); true when shown here. */
    onError(raw: string): boolean {
      const text = errHalf(raw, lang);
      if (recent('fam') && fam.onError(text)) { familiarSpots(); return true; }
      if (recent('exams') && exams.onError(text)) return true;
      return false;
    },
    /** K. */
    keydown(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
      if (e.key.toLowerCase() === 'k') { exams.toggle(); return true; }
      return false;
    },
    /** Esc: close the topmost of our panels. */
    closeTop(): boolean {
      if (exams.el.hidden) return false;
      exams.el.hidden = true;
      return true;
    },
    openExams: () => exams.toggle(true),
    /** The 下一步 line's view of these systems. */
    goalState() {
      return { exams: exams.progress() };
    },
    /** The Owl Post's (Esc) entries: the familiar's spot, and the ways into the features' panels (`links`) and the exams. */
    menuHtml(): string {
      return `<div id="op-fam" hidden></div>`;
    },
    menuLinks(links = ''): string {
      return `<p class="pn-links">${links}<button type="button" class="ghost" data-pn="exams">${ic('scroll')}${L('O.W.L. 考试', 'O.W.L. exams')} <kbd>K</kbd></button></p>`;
    },
    /** The spellbook's O.W.L. tab, next to the 咒语集市 tab (main.ts renderBookList). */
    bookTab: () => `<li data-pn="exams" class="tab owl-entry" title="${esc(L('普通巫师等级考试：每周 6 道题，交 Runes，隐藏用例评分（K）', 'O.W.L.s: six exams a week, hand in Runes, graded by hidden cases (K)'))}">${ic('scroll')}${L('考试', 'O.W.L.s')}</li>`,
  };
}

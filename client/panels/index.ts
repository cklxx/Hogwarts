import type * as THREE from 'three';
import { L, lang, placeName } from '../i18n';
import { ic } from '../ink';
import { createDa } from './da';
import { createDarkMark } from './darkmark';
import { createExams } from './exams';
import { createFamiliar } from './familiar';
import { LAWLESS_LABEL, bearing, esc, fmtDist, focusLevel, focusTip, pickLang } from './logic';
import { createStudy } from './study';
import type { DarkLordPin, ExamBoard, ExamList, FamiliarState, SitReport, UnfairState } from './types';

export type { UnfairState, FamiliarState } from './types';

/**
 * The panels for what the kernel already does but the browser did not show (docs/TODO.md 第二波 界面面板): the Dark
 * Lord (a Dark Mark over their head, a compass to them, your own warning ribbon), Dumbledore's Army (J), 偷师, the
 * O.W.L. exams (K), the familiar, the agent's concentration and the lawless zone. main.ts hands over what it knows
 * (PanelDeps) and routes messages here; everything is drawn in the one parchment component (.sheet, the ink set).
 */
export interface PMe {
  handle: string; name: string; year: number; reputation: number;
  unfair?: UnfairState | null;
  agent?: { familiar?: FamiliarState | null } | null;
}
export interface PanelDeps {
  send: (o: unknown) => void;
  toast: (t: string) => void;
  me: () => PMe | null;
  snap: () => { t: number; dl?: DarkLordPin | null } | null;
  myPos: () => { x: number; z: number } | null;
  camYaw: () => number;
  /** The model root of a wizard in view, by handle. */
  wizardRoot: (handle: string) => THREE.Object3D | null;
  agentConnected: () => boolean;
  spells: () => { id: string; name: string; builtin: boolean; source: string }[];
  wantSpells: () => void;
  openBook: () => void;
  loadDraft: (name: string, source: string, note: string) => void;
  solo: (el: HTMLElement) => void;
}

const $ = (id: string) => document.getElementById(id);
/** An element of the HUD this module owns, made on first use. */
function slot(id: string, make: () => HTMLElement): HTMLElement {
  let el = $(id);
  if (!el) { el = make(); el.id = id; }
  return el;
}
const setHtml = (el: HTMLElement, html: string) => { if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };

export function createPanels(d: PanelDeps) {
  /** When each panel last asked the server for something: an 'err' right after belongs to it. */
  const asked = { da: -1e9, exams: -1e9, fam: -1e9, study: -1e9 };
  const mark = (k: keyof typeof asked) => () => { asked[k] = performance.now(); };
  const recent = (k: keyof typeof asked) => performance.now() - asked[k] < 3000;
  const unfair = () => d.me()?.unfair ?? null;

  const da = createDa({ send: d.send, live: () => unfair()?.da ?? null, solo: d.solo, mark: mark('da'), toast: d.toast });
  const exams = createExams({ send: d.send, solo: d.solo, mark: mark('exams'), spells: d.spells, wantSpells: d.wantSpells });
  const fam = createFamiliar({ send: d.send, state: () => d.me()?.agent?.familiar ?? null, mark: mark('fam') });
  const study = createStudy({
    send: d.send, list: () => unfair()?.study ?? [], now: () => d.snap()?.t ?? 0, spells: d.spells,
    openBook: d.openBook, loadDraft: d.loadDraft, toast: d.toast, mark: mark('study'),
  });
  const mark3d = createDarkMark();

  // ------------------------------------------------------------------ the HUD pieces
  const hud = $('hud')!;
  /** Top centre, under the target frame: the Dark Lord's ribbon, the lawless label, the veto card, the joint spell. */
  const top = slot('pn-top', () => { const e = document.createElement('div'); hud.append(e); return e; });
  const vignette = slot('lawless', () => { const e = document.createElement('div'); e.hidden = true; e.setAttribute('aria-hidden', 'true'); hud.prepend(e); return e; });
  let jointUntil = 0;

  function compass() {
    const clock = $('clock');
    if (!clock) return;
    const el = slot('dl-compass', () => { const e = document.createElement('div'); e.hidden = true; clock.after(e); return e; });
    const s = d.snap(), me = d.me(), p = d.myPos();
    const dl = s?.dl ?? null;
    if (!dl || !me || !p || dl.h === me.handle) { el.hidden = true; return; }
    const { dist, rot } = bearing(p, dl, d.camYaw());
    setHtml(el, `${ic('darkmark')}<span class="dc-t"><b>${L('那个人', 'You-Know-Who')}</b> ${esc(dl.n)}<small>${esc(placeName(dl.p))}</small></span><span class="dc-d"><span class="arrow" style="transform:rotate(${rot.toFixed(2)}rad)">↑</span><span class="num">${fmtDist(dist)}</span></span>`);
    el.title = L('黑魔王的位置向全服公开：击晕 TA 夺走 30% 声望', "The Dark Lord's whereabouts are public: stunning them steals 30% of their reputation");
    el.hidden = false;
  }

  function topStack() {
    const u = unfair();
    const parts: string[] = [];
    if (u?.youAreDarkLord) parts.push(`<div class="dl-ribbon">${ic('darkmark')}<span><b>${L('你是黑魔王', 'You are the Dark Lord')}</b> · ${L('位置已向全服公开', 'your whereabouts are public')} · ${L('伤害 <b class="num">+15%</b>', 'damage <b class="num">+15%</b>')} · <small>${L('被击晕会被夺走 30% 声望', 'a stun steals 30% of your reputation')}</small></span></div>`);
    if (u?.lawless) parts.push(`<div class="lawless-label">${ic('arcane')}<span>${esc(LAWLESS_LABEL())}</span></div>`);
    const mini = da.mini();
    if (mini) parts.push(mini);
    if (performance.now() < jointUntil) parts.push(`<div class="joint">${ic('patronus')}<span><b>${L('联合守护神', 'Joint Patronus')}</b> · ${L('伤害 ×1.25：三名以上成员 4 秒内打中同一个目标', 'damage ×1.25: three or more members hit one target within 4 s')}</span></div>`);
    setHtml(top, parts.join(''));
    da.tick(top);
    top.hidden = !parts.length;
    vignette.hidden = !u?.lawless;
    document.body.classList.toggle('lawless', !!u?.lawless);
  }

  /** The agent's concentration: a small ink tube beside the owl glyph, only with an agent connected and the rule on. */
  function focus() {
    const glyph = document.querySelector('#agentbox .ab-glyph') as HTMLElement | null;
    if (!glyph) return;
    let m = glyph.parentElement!.querySelector('.ab-focus') as HTMLElement | null;
    const f = unfair()?.focus;
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
    if (t.closest('[data-da-open]')) { da.toggle(true); return; }
    if (t.closest('[data-pn="da"]')) { da.toggle(true); return; }
    if (t.closest('[data-pn="exams"]')) { exams.toggle(true); return; }
  });

  /** The spellbook's O.W.L. ribbon (a bookmark hanging from the top of the right page). */
  function bookRibbon() {
    const book = $('book');
    if (!book || $('book-owl')) return;
    const r = document.createElement('button');
    r.type = 'button';
    r.id = 'book-owl';
    r.dataset.pn = 'exams';
    r.title = L('普通巫师等级考试（K）', 'O.W.L. exams (K)');
    r.innerHTML = `${ic('scroll', 'mono')}<span>${L('考试', 'O.W.L.')}</span><kbd>K</kbd>`;
    book.append(r);
  }

  let frameT = 0;
  return {
    /** 10 Hz, from main.ts' hud(). */
    hud() {
      if (!d.me()) return;
      compass();
      topStack();
      focus();
      familiarSpots();
      study.update();
      bookRibbon();
      da.render();
    },
    /** Every frame: the Dark Mark follows its wizard. */
    frame(dt: number) {
      frameT += dt;
      const dl = d.snap()?.dl;
      mark3d.update(dl ? d.wizardRoot(dl.h) : null, frameT);
    },
    /** A server message for the panels; true when it was one. */
    onMessage(msg: { t: string; [k: string]: unknown }): boolean {
      switch (msg.t) {
        case 'welcome': fam.onWelcome(msg.familiar as FamiliarState | undefined); exams.refresh(); return false;
        case 'exams': exams.onList(msg.r as ExamList); return true;
        case 'sat': exams.onSat(msg.r as SitReport); return true;
        case 'examboard': { const r = msg.r as ExamBoard; if (r?.id) exams.onBoard(r); return true; }
        case 'da': da.onReply(String(msg.op ?? 'status'), msg.r as never); return true;
        case 'study': study.onReply(msg.r as never); return true;
        case 'familiar': fam.onReply(msg.s as FamiliarState); familiarSpots(); return true;
      }
      return false;
    },
    /** A world event: the joint Patronus (public 'da') lights the joint-strike badge. */
    onEvent(e: { type: string; to?: string; zh?: string; text: string }) {
      if (e.type === 'da' && !e.to) { jointUntil = performance.now() + 8000; if (d.me()) topStack(); }
    },
    /** An 'err' the panels asked for (already translated); true when shown here. */
    onError(raw: string): boolean {
      // the kernel's refusals are often "English 中文": show the reader's half
      const text = `✗ ${pickLang(raw.replace(/^✗\s*/, ''), lang)}`;
      if (recent('fam') && fam.onError(text)) { familiarSpots(); return true; }
      if (recent('exams') && exams.onError(text)) return true;
      if (recent('da') && da.onError(text)) return true;
      if (recent('study') && study.onError(text)) return true;
      return false;
    },
    /** J and K. */
    keydown(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
      const k = e.key.toLowerCase();
      if (k === 'j') { da.toggle(); return true; }
      if (k === 'k') { exams.toggle(); return true; }
      return false;
    },
    /** Esc: close the topmost of our panels. */
    closeTop(): boolean {
      for (const p of [exams, da]) if (!p.el.hidden) { p.el.hidden = true; return true; }
      return false;
    },
    openDa: () => da.toggle(true),
    openExams: () => exams.toggle(true),
    /** The 下一步 line's view of these systems. */
    goalState() {
      const u = unfair();
      return { exams: exams.progress(), da: u ? { member: u.da.member, eligible: u.da.eligible } : null, darkLord: !!u?.youAreDarkLord };
    },
    /** Extra lines for the leaderboard (L): 那个人, and the way into the DA. */
    boardHtml(lb: { darkLord?: { name: string; place: string; placeZh?: string; reputation: number } | null; darkLordRule?: string }): string {
      const dl = lb.darkLord;
      const u = unfair();
      return `<p class="pn-dl"><b>${ic('darkmark')}${L('黑魔王（那个人）', 'The Dark Lord (You-Know-Who)')}:</b> ${dl ? `${esc(dl.name)} · ${esc(L(dl.placeZh ?? placeName(dl.place), dl.place))} · ${L(`声望 ${dl.reputation}`, `${dl.reputation} reputation`)}` : L('无人戴着黑魔标记', 'nobody wears the Dark Mark')}<br/><small>${L('声望 ≥150 的第一名戴上黑魔标记：伤害 +15%，位置每 60 秒向全服公开；击晕 TA 夺走 30% 声望。挑战者要达到 TA 的 110% 才能夺走标记。', esc(lb.darkLordRule ?? ''))}</small></p>`
        + `<p class="pn-da"><button type="button" class="ghost" data-pn="da">${ic('patronus')}${L('邓布利多军', "Dumbledore's Army")} <kbd>J</kbd></button> <span class="hint">${u?.da.member ? L(`你是成员 · ${u.da.size} 人`, `you are a member · ${u.da.size}`) : u?.da.eligible ? L('弱者抱团：你可以加入，还能否决部长的法令', 'the underdogs: you may join, and veto the Minister') : L('弱者的联盟：否决部长的法令', 'the underdogs: they can veto the Minister')}</span></p>`;
    },
    /** The Owl Post's (Esc) entries: the familiar's spot and the way into the DA and the exams. */
    menuHtml(): string {
      return `<div id="op-fam" hidden></div>`;
    },
    menuLinks(): string {
      return `<p class="pn-links"><button type="button" class="ghost" data-pn="da">${ic('patronus')}${L('邓布利多军', "Dumbledore's Army")} <kbd>J</kbd></button> <button type="button" class="ghost" data-pn="exams">${ic('scroll')}${L('O.W.L. 考试', 'O.W.L. exams')} <kbd>K</kbd></button></p>`;
    },
    ids: ['da', 'exams'],
  };
}

/**
 * 手机壳 (a portrait phone, docs/PLAYTEST.md round 7): one owner for the whole screen instead of a dozen HUD pieces each
 * placing itself. The screen has three zones and nothing else may put words in the middle:
 *
 *   top      one row — your card, the clock, the drawer button (a dot when something is live in it), the owl
 *            under it, ONE message line: news, notes, private lines and each new goal queue for it, one at a time
 *   middle   the world: only name tags and damage numbers
 *   bottom   the stick (left), a 2 × 2 of book / act / target / roll (right), the bars and the hotbar
 *
 * Everything else — the next goal, the school event, today's lessons, the House Cup, the duel and Quidditch slips,
 * the message history, the rarely used buttons — lives in the drawer. The pieces are moved into it as they appear
 * (their own code keeps drawing them: a panel finds its element by id, wherever it is). CSS: phone.css.
 * Desktop never builds this.
 */
import { L } from './i18n';
import './phone.css';

/** Higher shows first. A line waits at most STALE_S; one on screen stays ON_S (longer for a long one, at most ON_MAX_S). */
export const PRIO = { news: 1, goal: 2, note: 3, hurt: 4 } as const;
export const ON_S = 3, ON_MAX_S = 5, STALE_S = 12, HISTORY = 40;
/** What moves into the drawer, in its order (the pieces that exist; a feature's slip once it appears). */
export const DRAWER_IDS = ['goal', 'evslip', 'duelslip', 'qdslip', 'studyslip', 'dl-compass', 'pn-top', 'quests', 'cupstrip'] as const;
/** Of those, the ones whose showing lights the dot on the drawer button. */
const LIVE_IDS = ['evslip', 'duelslip', 'qdslip', 'studyslip', 'dl-compass', 'pn-top'];

export interface Line { text: string; prio: number; at: number; act?: () => void }

/** The message queue on its own (no DOM): the next line to show at time `now`, or null. Unit-tested. */
export class MessageQueue {
  private q: Line[] = [];
  cur: Line | null = null;
  private until = 0;
  readonly history: { text: string; at: number }[] = [];
  push(text: string, prio: number, now: number, act?: () => void) {
    const t = text.trim();
    if (!t) return;
    this.history.push({ text: t, at: now });
    if (this.history.length > HISTORY) this.history.shift();
    // the same words twice (a repeated error, a news line said again) show once
    if (this.cur?.text === t || this.q.some((l) => l.text === t)) return;
    const l: Line = { text: t, prio, at: now, act };
    // something more urgent than what is on screen cuts in
    if (this.cur && prio > this.cur.prio) { this.q.unshift(this.cur); this.cur = null; }
    this.q.push(l);
  }
  /** Advance to `now`: returns the line on screen (the same object while it stays). */
  step(now: number): Line | null {
    if (this.cur && now >= this.until) this.cur = null;
    if (!this.cur) {
      this.q = this.q.filter((l) => now - l.at <= STALE_S || l.prio >= PRIO.hurt);
      if (!this.q.length) return null;
      let best = 0;
      for (let i = 1; i < this.q.length; i++) if (this.q[i].prio > this.q[best].prio) best = i;
      this.cur = this.q.splice(best, 1)[0];
      this.until = now + Math.min(ON_MAX_S, ON_S + this.cur.text.length * 0.05);
    }
    return this.cur;
  }
  /** Into the history only (the drawer's 消息 page): a public line that is not worth the screen. */
  log(text: string, now: number) { const t = text.trim(); if (!t) return; this.history.push({ text: t, at: now }); if (this.history.length > HISTORY) this.history.shift(); }
  /** Keep the line up a while longer (it was tapped open). */
  hold(now: number, secs: number) { if (this.cur) this.until = Math.max(this.until, now + secs); }
  dismiss() { this.cur = null; }
}

export function createPhoneShell() {
  document.body.classList.add('phone');
  const hud = document.getElementById('hud')!;
  const now = () => performance.now() / 1000;
  const mq = new MessageQueue();

  const line = document.createElement('div');
  line.id = 'pmsg';
  line.hidden = true;
  hud.append(line);
  let shown: Line | null = null;
  line.addEventListener('click', () => {
    if (!shown) return;
    if (shown.act) { const a = shown.act; mq.dismiss(); a(); return; }
    // tapped: the whole text, a little longer
    line.classList.toggle('full');
    mq.hold(now(), 6);
  });

  const btn = document.createElement('button');
  btn.id = 'pd-btn';
  btn.type = 'button';
  btn.title = L('更多：目标、事件、课表、消息', 'More: goal, event, lessons, messages');
  btn.innerHTML = '<svg class="ic"><use href="#i-scroll"/></svg><i></i>';
  hud.append(btn);

  const drawer = document.createElement('div');
  drawer.id = 'pdrawer';
  drawer.className = 'sheet';
  drawer.hidden = true;
  drawer.innerHTML = `<button class="x" data-close="pdrawer" type="button"><svg class="ic"><use href="#i-x"/></svg></button>`
    + `<div class="pd-tabs"><button type="button" data-p="now" class="on">${L('现在', 'Now')}</button><button type="button" data-p="log">${L('消息', 'Messages')}</button><button type="button" data-p="more">${L('更多', 'More')}</button></div>`
    + `<div class="pd-page" data-p="now"></div><div class="pd-page" data-p="log" hidden><ul class="pd-log"></ul></div><div class="pd-page" data-p="more" hidden></div>`;
  hud.append(drawer);
  const page = (p: string) => drawer.querySelector(`.pd-page[data-p="${p}"]`) as HTMLElement;
  const more = page('more');
  // the rarely used buttons: the old ⋯ drawer's, and zoom (a pinch does it too)
  const extra = document.getElementById('tb-extra');
  if (extra) { extra.hidden = false; more.append(extra); }
  for (const id of ['tb-zin', 'tb-zout']) { const b = document.getElementById(id); if (b) more.append(b); }
  // a word under each (their titles are sentences)
  const LB: Record<string, [string, string]> = { 'tb-menu': ['菜单', 'Menu'], 'tb-owl': ['Agent', 'Agent'], 'tb-trunk': ['行囊', 'Trunk'], 'tb-chat': ['聊天', 'Chat'], 'tb-help': ['帮助', 'Help'], 'tb-view': ['视角', 'View'], 'tb-full': ['全屏', 'Full'], 'tb-zin': ['拉近', 'Closer'], 'tb-zout': ['拉远', 'Further'] };
  for (const b of Array.from(more.querySelectorAll('button'))) { const l = LB[b.id]; if (l) b.dataset.lb = L(l[0], l[1]); }

  const open = (on: boolean) => {
    drawer.hidden = !on;
    if (on) { renderLog(); seen = liveSig(); }
  };
  btn.addEventListener('click', () => open(drawer.hidden));
  drawer.addEventListener('click', (e) => {
    // a tap on the event slip walks you there (fun.ts): the drawer gets out of the way
    if ((e.target as HTMLElement).closest('#evslip')) { open(false); return; }
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.close === 'pdrawer') { open(false); return; }
    if (b.dataset.p && b.parentElement?.classList.contains('pd-tabs')) {
      for (const t of Array.from(drawer.querySelectorAll('.pd-tabs button'))) t.classList.toggle('on', t === b);
      for (const pg of Array.from(drawer.querySelectorAll('.pd-page'))) (pg as HTMLElement).hidden = (pg as HTMLElement).dataset.p !== b.dataset.p;
      if (b.dataset.p === 'log') renderLog();
      return;
    }
    // a button in the More page (menu, owl, trunk, chat, help, view, full screen): it did its thing, the drawer goes
    if (b.closest('.pd-page[data-p="more"]') && !b.id.startsWith('tb-z')) open(false);
  });
  function renderLog() {
    const ul = drawer.querySelector('.pd-log')!;
    const t = now();
    ul.innerHTML = mq.history.slice().reverse().map((h) => `<li><small>${Math.max(0, Math.round((t - h.at) / 60))}′</small>${esc(h.text)}</li>`).join('') || `<li class="hint">${L('还没有消息', 'Nothing yet')}</li>`;
  }

  const visible = (id: string) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
  const liveSig = () => LIVE_IDS.filter(visible).join(',');
  let seen = '';

  return {
    say(text: string, prio: number = PRIO.news, act?: () => void) { mq.push(text, prio, now(), act); },
    log(text: string) { mq.log(text, now()); },
    open,
    /** 10 Hz (main.ts hud): gather the pieces into the drawer, the dot, the message line. */
    tick() {
      const pg = page('now');
      for (const id of DRAWER_IDS) {
        const e = document.getElementById(id);
        if (e && e.parentElement !== pg) pg.append(e);
      }
      // keep the drawer's order as listed (a piece made later lands at the end)
      const kids = DRAWER_IDS.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
      if (kids.some((e, i) => pg.children[i] !== e)) for (const e of kids) pg.append(e);
      const sig = liveSig();
      btn.classList.toggle('dot', !!sig && sig !== seen && drawer.hidden);
      const l = mq.step(now());
      if (l !== shown) {
        shown = l;
        line.classList.remove('full');
        line.classList.toggle('act', !!l?.act);
        line.textContent = l?.text ?? '';
        line.hidden = !l;
      }
    },
    history: () => mq.history,
  };
}
export type PhoneShell = ReturnType<typeof createPhoneShell>;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

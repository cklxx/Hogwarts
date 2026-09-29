/**
 * 决斗俱乐部 in the browser (src/kernel/duelclub.ts): G joins or leaves the queue; a slip under the clock shows the
 * match on the stage (who, phase, seconds) or your place in the queue, with a compass to the Courtyard stage.
 */
import { L } from '../i18n';
import { ic } from '../ink';
import { bearing, esc, fmtDist } from './logic';

/** Snapshot `du` (duelWire). */
export interface DuSnap { a?: string; b?: string; ph: 'bow' | 'count' | 'fight'; t: number }
interface DuelStatus { closed?: string | false | null; stage: { x: number; z: number }; queue: number; you: { position?: number; inMatch?: boolean } | null }

export interface DuelDeps {
  send: (o: unknown) => void;
  toast: (t: string) => void;
  du: () => DuSnap | undefined;
  nameOf: (handle: string | undefined) => string;
  myHandle: () => string;
  myPos: () => { x: number; z: number } | null;
  camYaw: () => number;
}

const PHASE = { bow: ['鞠躬', 'Bow'], count: ['倒数', 'Countdown'], fight: ['决斗中', 'Duel'] } as const;

/** One line for the slip; pure, for tests. */
export function duelLine(du: DuSnap | undefined, st: DuelStatus | null, nameOf: (h: string | undefined) => string, me: string): { title: string; sub: string; mine: boolean } | null {
  if (du) {
    const mine = du.a === me || du.b === me;
    const [zh, en] = PHASE[du.ph];
    return { title: `${nameOf(du.a)} ⚔ ${nameOf(du.b)}`, sub: `${L(zh, en)} · ${du.t}s${mine && du.ph !== 'fight' ? L(' · 站定，不能施法', ' · hold still, no casting') : ''}`, mine };
  }
  if (st?.you?.position) return { title: L('决斗俱乐部', 'Duelling Club'), sub: L(`排队中：第 ${st.you.position} 位 · 按 G 退出`, `queued: #${st.you.position} · G to leave`), mine: true };
  return null;
}

export function createDuel(d: DuelDeps) {
  let status: DuelStatus | null = null;
  let asked = 0;
  function slip(): HTMLElement | null {
    let el = document.getElementById('duelslip');
    if (el) return el;
    const clock = document.getElementById('clock');
    if (!clock?.parentElement) return null;
    el = document.createElement('div');
    el.id = 'duelslip';
    (document.getElementById('evslip') ?? document.getElementById('dl-compass') ?? clock).after(el);
    return el;
  }
  return {
    /** 10 Hz from main.ts' hud(). */
    hud() {
      const el = slip();
      if (!el) return;
      const du = d.du();
      // a match that started or ended moves you out of the queue without a reply: follow the snapshot quietly
      if (status) {
        const inDu = !!du && (du.a === d.myHandle() || du.b === d.myHandle());
        if (inDu) status.you = { inMatch: true };
        else if (status.you?.inMatch) status.you = null;
      }
      // the queue position only comes on request: refresh it every few seconds while you wait
      if (!du && status?.you?.position && performance.now() - asked > 3000) { asked = performance.now(); d.send({ t: 'duel', op: 'status' }); }
      const line = duelLine(du, status, d.nameOf, d.myHandle());
      if (!line) { el.hidden = true; return; }
      const p = d.myPos(), stage = status?.stage ?? { x: 0, z: -30 };
      let dir = '';
      if (line.mine && p) {
        const { dist, rot } = bearing(p, stage, d.camYaw());
        if (dist > 12) dir = `<span class="es-d"><span class="arrow" style="transform:rotate(${rot.toFixed(2)}rad)">↑</span><span class="num">${fmtDist(dist)}</span></span>`;
      }
      const html = `${ic(du ? 'wand' : 'hourglass')}<div class="es-t"><b>${esc(line.title)}</b><small>${esc(line.sub)}</small></div>${dir}`;
      if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
      el.className = `es on${line.mine ? ' mine' : ''}${du?.ph === 'fight' ? ' fight' : ''}`;
      el.hidden = false;
    },
    keydown(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
      if (e.key !== 'g' && e.key !== 'G') return false;
      const inIt = !!status?.you || (() => { const du = d.du(); return !!du && (du.a === d.myHandle() || du.b === d.myHandle()); })();
      d.send({ t: 'duel', op: inIt ? 'leave' : 'join' });
      return true;
    },
    /** The server's reply to {t:'duel'} (duelStatus); true when handled. */
    onMessage(msg: { t: string; r?: DuelStatus }): boolean {
      if (msg.t !== 'duel' || !msg.r) return false;
      const was = status?.you;
      status = msg.r;
      const now = status.you;
      if (!was && now?.position) d.toast(L(`⚔ 已报名决斗俱乐部（第 ${now.position} 位）。去庭院的决斗台，凑齐两人就开打；30 秒没人来，NPC 陪你练。`, `⚔ Queued for the Duelling Club (#${now.position}). Head to the Courtyard stage; two make a match, and after 30 s an NPC spars with you.`));
      else if (was && !now) d.toast(L('⚔ 已离开决斗俱乐部。', '⚔ Left the Duelling Club.'));
      return true;
    },
  };
}

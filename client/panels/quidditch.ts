/**
 * 魁地奇 in the browser (src/kernel/quidditch.ts): P joins or leaves while a match is called or played; F throws the
 * Quaffle you carry at the nearest hoop at the other end. A slip under the clock shows the score, the clock, the
 * Snitch and your role, with a compass to the pitch while you are not on it.
 */
import { houseName, L } from '../i18n';
import { ic } from '../ink';
import type { ClientFeatureFactory } from '../feature';
import { createQuidditch3d, type QdSnap } from '../quidditch3d';
import { bearing, esc, fmtDist } from './logic';

export interface QdDeps {
  send: (o: unknown) => void;
  toast: (t: string) => void;
  qd: () => QdSnap | undefined;
  myHandle: () => string;
  myHouse: () => string | null;
  myPos: () => { x: number; z: number } | null;
  camYaw: () => number;
}

const PITCH = { x: 40, z: -150 };
const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface League { season: number; table: { house: string; pts: number; played: number }[] }
/** The season's table in one line (the reply to P when no match is on); pure, for tests. */
export function leagueLine(l: League | undefined): string {
  if (!l?.table.length) return '';
  const rows = l.table.map((r) => `${houseName(r.house)} ${r.pts}`);
  return L(` 第 ${l.season} 赛季积分：${rows.join(' · ')}`, ` Season ${l.season} table: ${rows.join(' · ')}`);
}

/** The slip's two lines; pure, for tests. */
export function qdLine(qd: QdSnap | undefined, me: string, house: string | null): { title: string; sub: string; mine: boolean; canJoin: boolean } | null {
  if (!qd) return null;
  const mine = qd.r.find((r) => r[0] === me);
  const side = mine ? mine[1] : house ? qd.s.indexOf(house) : -1;
  const title = `${houseName(qd.s[0])} ${qd.sc[0]} : ${qd.sc[1]} ${houseName(qd.s[1])}`;
  const canJoin = !mine && side >= 0 && qd.ph !== 'done';
  let sub: string;
  if (qd.ph === 'call') sub = L(`魁地奇 ${mm(qd.t)} 后开赛`, `Quidditch in ${mm(qd.t)}`);
  else if (qd.ph === 'done') sub = qd.w === null || qd.w === undefined ? L('终场：平局', 'Full time: a draw') : L(`终场：${houseName(qd.s[qd.w])}获胜`, `Full time: ${houseName(qd.s[qd.w])} win`) + (qd.c ? L(`（${qd.c} 抓住了飞贼）`, ` (${qd.c} caught the Snitch)`) : '');
  else sub = `${mm(qd.t)} · ${qd.sn ? L('金色飞贼出现了！', 'The Snitch is out!') : L(`飞贼 ${qd.sa} 秒后出现`, `Snitch in ${qd.sa}s`)}`;
  if (mine) {
    const role = mine[2] === 1 ? L('找球手', 'Seeker') : mine[2] === 2 ? L('守门员', 'Keeper') : L('追球手', 'Chaser');
    const carrying = qd.q?.[2] === me;
    sub += ` · ${role}${carrying ? L(' · 球在你手里：F 射门', ' · you have the Quaffle: F to shoot') : ''}`;
  } else if (canJoin) sub += L(' · 按 P 上场', ' · P to play');
  else if (side < 0 && qd.ph !== 'done') sub += L(' · 去看台上加油', ' · cheer from the stands');
  return { title, sub, mine: !!mine, canJoin };
}

export function createQuidditch(d: QdDeps) {
  let lastPh = '';
  function slip(): HTMLElement | null {
    let el = document.getElementById('qdslip');
    if (el) return el;
    const clock = document.getElementById('clock');
    if (!clock?.parentElement) return null;
    el = document.createElement('div');
    el.id = 'qdslip';
    (document.getElementById('duelslip') ?? document.getElementById('evslip') ?? clock).after(el);
    return el;
  }
  const inIt = () => !!d.qd()?.r.some((r) => r[0] === d.myHandle());
  return {
    /** 10 Hz from main.ts' hud(). */
    hud() {
      const el = slip();
      if (!el) return;
      const qd = d.qd();
      if (qd && qd.ph !== lastPh && qd.ph === 'call' && qd.s.includes(d.myHouse() ?? '')) d.toast(L(`🧹 魁地奇要开赛了：${houseName(qd.s[0])}对${houseName(qd.s[1])}。去球场，按 P 上场。`, `🧹 Quidditch soon: ${houseName(qd.s[0])} v ${houseName(qd.s[1])}. Head to the pitch and press P.`));
      lastPh = qd?.ph ?? '';
      const line = qdLine(qd, d.myHandle(), d.myHouse());
      if (!line) { el.hidden = true; return; }
      const p = d.myPos();
      let dir = '';
      if (p && qd!.ph !== 'done') {
        const { dist, rot } = bearing(p, PITCH, d.camYaw());
        if (dist > 30) dir = `<span class="es-d"><span class="arrow" style="transform:rotate(${rot.toFixed(2)}rad)">↑</span><span class="num">${fmtDist(dist)}</span></span>`;
      }
      const html = `${ic(qd!.sn ? 'snitch' : 'broom')}<div class="es-t"><b>${esc(line.title)}</b><small>${esc(line.sub)}</small></div>${dir}`;
      if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
      el.className = `es on${line.mine ? ' mine' : ''}${qd!.ph === 'play' ? ' fight' : ''}`;
      el.hidden = false;
    },
    keydown(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
      const qd = d.qd();
      if ((e.key === 'f' || e.key === 'F') && qd?.ph === 'play' && qd.q?.[2] === d.myHandle()) { d.send({ t: 'quidditch', op: 'throw' }); return true; }
      if (e.key !== 'p' && e.key !== 'P') return false;
      if (!qd || qd.ph === 'done') { d.send({ t: 'quidditch', op: 'status' }); return true; }
      d.send({ t: 'quidditch', op: inIt() ? 'leave' : 'join' });
      return true;
    },
    /** The server's reply to {t:'quidditch'} (qdStatus); true when handled. */
    onMessage(msg: { t: string; r?: { match: unknown; next: { teams: [string, string]; callsIn?: number; term: number } | null; you: { role: string } | null; league?: League } }): boolean {
      if (msg.t !== 'quidditch' || !msg.r) return false;
      const r = msg.r;
      const role = r.you?.role;
      if (r.you) d.toast(L(`🧹 你上场了：${role === 'seeker' ? '找球手——盯住金色飞贼' : role === 'keeper' ? '守门员——守住自己的三个球门' : '追球手——碰到鬼飞球就拿，F 射门'}。`, `🧹 You're on: ${role === 'seeker' ? 'Seeker — watch for the Snitch' : role === 'keeper' ? 'Keeper — guard your three hoops' : 'Chaser — touch the Quaffle to take it, F to shoot'}.`));
      else if (!r.match && r.next) d.toast(L(`🧹 下一场魁地奇：${houseName(r.next.teams[0])}对${houseName(r.next.teams[1])}${r.next.callsIn !== undefined ? `，${r.next.callsIn} 秒后集合` : '，下学期'}。`, `🧹 Next Quidditch: ${houseName(r.next.teams[0])} v ${houseName(r.next.teams[1])}${r.next.callsIn !== undefined ? `, called in ${r.next.callsIn}s` : ', next term'}.`) + leagueLine(r.league));
      else if (r.match && !r.you) d.toast(L('🧹 你下场了。', '🧹 You left the pitch.'));
      return true;
    },
  };
}

/** Quidditch as a client feature (client/features.ts): the slip and keys, and the match in 3D. */
export const quidditchFeature: ClientFeatureFactory = (d) => {
  const qd = () => d.wire<QdSnap>('qd');
  const ui = createQuidditch({ send: d.send, toast: d.toast, qd, myHandle: d.myHandle, myHouse: d.myHouse, myPos: d.myPos, camYaw: d.camYaw });
  const world = createQuidditch3d(d.posOf, d.facingOf);
  // (its keys act: not while you watch your agent play)
  return { id: 'quidditch', widgets: [{ id: 'qdslip', zh: '魁地奇', en: 'Quidditch' }], ...ui, keydown: (e) => !d.observing() && ui.keydown(e), group: world.group, frame: (dt) => world.frame(dt, qd()), lift: world.lift };
};

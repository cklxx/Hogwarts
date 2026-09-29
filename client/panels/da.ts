import type { ClientFeatureFactory } from '../feature';
import { L, lang } from '../i18n';
import { ic } from '../ink';
import { daStanding, errHalf, esc, fmtClock, quorumMet, vetoPhase } from './logic';
import type { DaView } from './types';

/**
 * 邓布利多军 (key J): whether you may join, join / leave, how many are in and online against the quorum, the members
 * (members only), and — while the Minister's last decree can still be vetoed — the big 「否决法令」 vote card with its
 * countdown and votes. The live numbers come from me.da (5 Hz); the {t:'da'} reply adds why you may not join,
 * who is admitted and the joint spell's numbers. daFeature (the end of this file) plugs it in (client/features.ts):
 * the vote card and the joint-Patronus badge in the top stack, the leaderboard's and the Owl Post's way in.
 */
export interface DaDeps {
  send: (o: unknown) => void;
  live: () => DaView | null;
  solo: (el: HTMLElement) => void;
  mark: () => void;
  toast: (t: string) => void;
}

export function createDa(d: DaDeps) {
  const el = document.createElement('div');
  el.id = 'da';
  el.className = 'sheet';
  el.hidden = true;
  document.getElementById('hud')!.append(el);
  let reply: DaView | null = null;
  let msg = '', ok = false, last = '';

  /** The reply's extras over the live counts. */
  const view = (): DaView | null => {
    const live = d.live();
    if (!live) return reply;
    return { ...(reply ?? {}), ...live, members: live.members ?? (live.member ? reply?.members : undefined) } as DaView;
  };
  function toggle(force?: boolean) {
    el.hidden = !(force ?? el.hidden);
    if (!el.hidden) { d.solo(el); msg = ''; d.send({ t: 'da', op: 'status' }); last = ''; render(); }
  }
  function act(op: 'join' | 'leave' | 'veto') { msg = ''; ok = false; d.mark(); d.send({ t: 'da', op }); }

  function vetoCard(da: DaView, big: boolean): string {
    const v = da.veto, dec = v.decree!;
    const pips = Array.from({ length: Math.max(v.needed, v.votes) }, (_, i) => `<i class="${i < v.votes ? 'on' : ''}"></i>`).join('');
    const phase = vetoPhase(da);
    const can = da.member && phase === 'open';
    const button = da.member
      ? phase === 'voted' ? `<span class="vt-done">${ic('check')}${L('你已投票，等其他成员', 'You voted: waiting for the others')}</span>`
        : `<button type="button" class="vt-go" data-da="veto"${can ? '' : ' disabled'}>${ic('seal-broken')}${L('投票否决', 'Vote to veto')}</button>`
      : `<span class="hint">${L('只有邓布利多军成员能投票。', "Only members of Dumbledore's Army vote.")}</span>`;
    return `<section class="veto${big ? ' big' : ''}">
      <div class="vt-h">${ic('seal')}<b>${L('否决法令', 'Veto the decree')}</b><span class="vt-clock num" data-clock title="${esc(L('窗口剩余', 'left in the window'))}"></span></div>
      <p class="vt-who">${L(`魔法部长 <b>${esc(dec.minister)}</b> 刚颁布了一道法令：`, `Minister <b>${esc(dec.minister)}</b> has just decreed:`)}</p>
      ${big && dec.changes.length ? `<ul class="vt-ch">${dec.changes.slice(0, 6).map((c) => `<li><code>${esc(c)}</code></li>`).join('')}${dec.changes.length > 6 ? `<li class="hint">…${dec.changes.length - 6}</li>` : ''}</ul>` : ''}
      <div class="vt-votes"><span class="pips">${pips}</span><span>${L(`<b class="num">${v.votes}</b>/<span class="num">${v.needed}</span> 票`, `<b class="num">${v.votes}</b>/<span class="num">${v.needed}</span> votes`)} · ${L(`在线成员 ${da.online}（法定人数 ${da.quorum}）`, `${da.online} members online (quorum ${da.quorum})`)}</span></div>
      ${quorumMet(da) ? '' : `<p class="warn">${L(`在线成员不足 ${da.quorum} 人：凑够人数才能否决。`, `Fewer than ${da.quorum} members online: the veto needs a quorum.`)}</p>`}
      <div class="vt-act">${button}</div>
    </section>`;
  }

  function render() {
    if (el.hidden) return;
    const da = view();
    const phase = vetoPhase(da);
    const standing = daStanding(da);
    const admits = da?.admits ? L(`声望低于 ${da.admits.belowReputation}，或低于在线玩家的中位数（现在 ${da.admits.orBelowMedian}）即可加入；部长和黑魔王不能加入。`, `Reputation below ${da.admits.belowReputation}, or below the median of players online (now ${da.admits.orBelowMedian}); the Minister and the Dark Lord cannot join.`) : '';
    const joint = da?.joint ?? { members: 3, withinSeconds: 4, damagePct: 125 };
    const members = da?.member && da.members?.length
      ? `<ul class="da-mem">${da.members.map((m) => `<li><i class="dot${m.online ? ' on' : ''}"></i>${esc(m.name)}</li>`).join('')}</ul>`
      : da && !da.member ? `<p class="hint">${L('成员名单只有成员能看到。', 'Only members see who the members are.')}</p>` : '';
    const html = `<h2>${ic('patronus')}<span>${L('邓布利多军', "Dumbledore's Army")} <small>${L('弱者的联盟', 'the underdogs')} · <kbd>J</kbd></small></span> <button class="x" data-close="da" title="Esc"><svg class="ic"><use href="#i-x"/></svg></button></h2>
      ${!da ? `<p class="hint">${L('正在打听有求必应屋……', 'Asking the Room of Requirement…')}</p>` : `
      <p class="da-stand ${da.member ? 'in' : da.eligible ? 'can' : 'no'}">${esc(standing)}</p>
      ${admits ? `<p class="hint">${admits}</p>` : ''}
      <div class="da-stats">
        <span><b class="num">${da.size}</b>${da.max ? `<small>/${da.max}</small>` : ''} ${L('名成员', 'members')}</span>
        <span><b class="num">${da.online}</b> ${L('在线', 'online')}</span>
        <span class="${quorumMet(da) ? 'met' : ''}">${L('法定人数', 'quorum')} <b class="num">${da.quorum}</b>${quorumMet(da) ? ` ${ic('check')}` : ''}</span>
      </div>
      <div class="row">${da.member ? `<button type="button" class="ghost" data-da="leave">${L('退出', 'Leave')}</button>` : `<button type="button" data-da="join"${da.eligible ? '' : ' disabled'}>${ic('patronus')}${L('加入邓布利多军', "Join Dumbledore's Army")}</button>`}</div>
      ${msg ? `<p class="${ok ? 'ok' : 'err'}">${esc(msg)}</p>` : ''}
      ${phase === 'open' || phase === 'voted' ? vetoCard(da, true) : `<section class="veto idle"><div class="vt-h">${ic('seal')}<b>${L('否决法令', 'Veto the decree')}</b></div><p>${phase === 'used' ? L('本学期的否决权已经用过了（每学期 1 次）。', 'The veto has been used this term (once per term).') : L(`部长颁布法令后 ${da.veto.windowSeconds} 秒内，在线成员 ≥ ${da.quorum} 且过半数投票，法令就作废：规则书恢复原样，部长的铜像被推倒。每学期 ${da.veto.perTerm} 次。`, `Within ${da.veto.windowSeconds}s of a decree, with ≥ ${da.quorum} members online and a majority of them voting, the decree is undone: the rulebook goes back and the Minister's statue falls. ${da.veto.perTerm} per term.`)}</p></section>`}
      <h3>${ic('patronus')}${L('联合守护神', 'The joint Patronus')}</h3>
      <p>${L(`≥ ${joint.members} 名成员 ${joint.withinSeconds} 秒内打中同一个目标，他们的伤害 ×${(joint.damagePct / 100).toFixed(2)}（人再多也不叠加）。`, `≥ ${joint.members} members hitting one target within ${joint.withinSeconds}s deal ×${(joint.damagePct / 100).toFixed(2)} (it never stacks higher).`)}</p>
      ${members ? `<h3>${ic('figures')}${L('成员', 'Members')}</h3>${members}` : ''}`}`;
    if (html !== last) { el.innerHTML = html; last = html; }
    tick(el);
  }
  /** The countdowns tick without redrawing the card (so the vote button under the pointer stays put). */
  function tick(root: ParentNode) {
    const left = view()?.veto.decree?.secondsLeft;
    const t = left === undefined ? '' : fmtClock(left);
    root.querySelectorAll<HTMLElement>('[data-clock]').forEach((c) => { if (c.textContent !== t) c.textContent = t; });
  }
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-da]') as HTMLButtonElement | null;
    if (b && !b.disabled) act(b.dataset.da as 'join' | 'leave' | 'veto');
  });

  /** The small card at the top of the screen for members while a veto window is open. */
  function mini(): string {
    const da = d.live();
    if (!da?.member || vetoPhase(da) !== 'open' || !el.hidden) return '';
    const v = da.veto;
    return `<div class="vt-mini">${ic('seal')}<span><b>${L('否决法令', 'Veto the decree')}</b><span class="vm-who"> · ${L(`部长 ${esc(v.decree!.minister)} 的法令`, `${esc(v.decree!.minister)}'s decree`)}</span> · <span class="num" data-clock></span> · ${L(`${v.votes}/${v.needed} 票`, `${v.votes}/${v.needed} votes`)}</span><button type="button" data-da-open="1">${L('去投票', 'Vote')} <kbd>J</kbd></button></div>`;
  }

  return {
    el, toggle, render, mini, tick,
    onReply(op: string, r: DaView & { vetoed?: boolean; votes?: number; needed?: number }) {
      if (op === 'veto') {
        ok = true;
        msg = r.vetoed ? L('否决成功：法令作废，规则书恢复原样。', 'Vetoed: the decree is undone and the rulebook restored.') : L(`已投票（${r.votes}/${r.needed}）。`, `Voted (${r.votes}/${r.needed}).`);
        if (r.vetoed) d.toast(msg);
        d.send({ t: 'da', op: 'status' });
      } else {
        reply = r;
        if (op === 'join') { ok = true; msg = L('欢迎加入邓布利多军。', "Welcome to Dumbledore's Army."); }
        if (op === 'leave') { ok = true; msg = L('你退出了邓布利多军。', "You left Dumbledore's Army."); }
      }
      render();
    },
    onError(text: string) { if (el.hidden) return false; msg = text; ok = false; render(); return true; },
  };
}

/** Dumbledore's Army as a client feature (client/features.ts; src/kernel/unfair.ts DA_FEATURE). */
export const daFeature: ClientFeatureFactory = (d) => {
  let asked = -1e9, jointUntil = 0;
  const live = () => (d.me()?.da as (DaView & { jointBadge?: number }) | undefined) ?? null;
  const da = createDa({ send: d.send, live, solo: d.solo, mark: () => { asked = performance.now(); }, toast: d.toast });
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-da-open], [data-pn="da"]')) da.toggle(true);
  });
  return {
    id: 'da',
    hud() { if (!d.me()) return; da.render(); da.tick(document.getElementById('pn-top') ?? document); },
    top() {
      const joint = performance.now() < jointUntil || (live()?.jointBadge ?? 0) > 0;
      return da.mini() + (joint ? `<div class="joint">${ic('patronus')}<span><b>${L('联合守护神', 'Joint Patronus')}</b> · ${L('伤害 ×1.25：三名以上成员 4 秒内打中同一个目标', 'damage ×1.25: three or more members hit one target within 4 s')}</span></div>` : '');
    },
    keydown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'j') return false;
      da.toggle();
      return true;
    },
    /** {t:'da', r: {op, …}} */
    onMessage(msg) {
      if (msg.t !== 'da') return false;
      const r = msg.r as DaView & { op?: string };
      da.onReply(String(r?.op ?? 'status'), r as never);
      return true;
    },
    onError: (text) => performance.now() - asked < 3000 && da.onError(errHalf(text, lang)),
    // the joint Patronus (a public 'da' event) lights the badge
    onEvent(e) { if (e.type === 'da' && !e.to) jointUntil = performance.now() + 8000; },
    close() { if (da.el.hidden) return false; da.el.hidden = true; return true; },
    open(what) { if (what !== 'da') return false; da.toggle(true); return true; },
    goal() { const u = live(); return { da: u ? { member: u.member, eligible: u.eligible } : null }; },
    board() {
      const u = live();
      return `<p class="pn-da"><button type="button" class="ghost" data-pn="da">${ic('patronus')}${L('邓布利多军', "Dumbledore's Army")} <kbd>J</kbd></button> <span class="hint">${u?.member ? L(`你是成员 · ${u.size} 人`, `you are a member · ${u.size}`) : u?.eligible ? L('弱者抱团：你可以加入，还能否决部长的法令', 'the underdogs: you may join, and veto the Minister') : L('弱者的联盟：否决部长的法令', 'the underdogs: they can veto the Minister')}</span></p>`;
    },
    menu: () => `<button type="button" class="ghost" data-pn="da">${ic('patronus')}${L('邓布利多军', "Dumbledore's Army")} <kbd>J</kbd></button> `,
  };
};

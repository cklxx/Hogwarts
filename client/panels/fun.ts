import { HOUSES, type House } from '../../src/shared/constants';
import { CARD_BY_ID, CARD_SETS, type Card } from '../../src/lore/cards';
import { CHESTS } from '../../src/shared/chests';
import { L, houseName } from '../i18n';
import { houseIcon, ic } from '../ink';
import {
  EVENT_INK, RARITY_INK, RevealQueue, albumModel, bossFrac, countdown, curfewHint, evTarget, finalMinute, monogram, objective, resultLine, stripModel,
  type CeremonySnap, type CupSnap, type EvSnap, type FunMe,
} from '../funlogic';
import { bearing, esc, fmtDist } from './logic';

/**
 * Sprint 1's HUD (README 学院杯 / 校园事件轮盘 / 巧克力蛙画片): the house strip with the countdown (top centre), the
 * troll's shared HP bar under it, the event slip with its compass (under the clock, like the Dark Lord's), the curfew
 * hint (Filch's lantern reddens the edge), the House Cup ceremony card, the album (C) and the card reveal. The HUD
 * stays calm: while the ceremony or a card reveal holds the centre, big banners go to the feed instead
 * (claimsCentre()). Everything is parchment and ink, ≥ 15 px at scale 1, and scales with --u.
 */
export interface FunDeps {
  send: (o: unknown) => void;
  toast: (t: string) => void;
  me: () => { handle: string; house: House; fun?: FunMe | null; map?: unknown } | null;
  snap: () => { t: number; cup?: CupSnap; ev?: EvSnap | null } | null;
  myPos: () => { x: number; z: number } | null;
  camYaw: () => number;
  solo: (el: HTMLElement) => void;
  /** Walk there by the paths (controls.ts walkTo): a tap on the event slip takes you to it. */
  walkTo: (x: number, z: number) => void;
}

const $ = (id: string) => document.getElementById(id);
function slot(id: string, parent: () => HTMLElement, where: 'append' | 'prepend' | ((e: HTMLElement) => void) = 'append', tag = 'div'): HTMLElement {
  let el = $(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    if (typeof where === 'function') where(el);
    else parent()[where](el);
  }
  return el;
}
const setHtml = (el: HTMLElement, html: string) => { if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function createFun(d: FunDeps) {
  const hud = () => $('hud')!;
  const strip = slot('cupstrip', hud);
  strip.setAttribute('aria-live', 'off');
  const edge = slot('curfewedge', hud, 'prepend');
  edge.hidden = true;
  edge.setAttribute('aria-hidden', 'true');
  const cer = slot('ceremony', hud);
  cer.hidden = true;
  cer.addEventListener('click', () => { cer.hidden = true; dismissed = shownTerm; });
  const reveal = slot('cardreveal', hud);
  reveal.hidden = true;
  reveal.addEventListener('click', () => endReveal());
  const album = slot('album', hud);
  album.className = 'sheet';
  album.hidden = true;
  let albumFilter: 'all' | 'owned' | 'missing' = 'all';
  let albumPick: string | null = null;
  let shownTerm = 0, dismissed = 0;
  const queue = new RevealQueue();
  let revealUntil = 0;
  let revealTimer = 0;

  // ------------------------------------------------------------------ the house strip
  function renderStrip() {
    const s = d.snap(), me = d.me();
    const cup = s?.cup;
    document.body.classList.toggle('cup', !!cup);
    if (!cup) { strip.hidden = true; return; }
    const fm = finalMinute(cup);
    const segs = stripModel(cup, me?.house).map((x) => `<span class="cs-h${x.lead ? ' lead' : ''}${x.mine ? ' mine' : ''}" data-house="${x.house}" title="${esc(houseName(x.house))}">${ic(houseIcon(x.house))}<b class="num">${x.pts}</b><i style="--w:${(x.share * 100).toFixed(1)}%"></i></span>`);
    const mid = `<span class="cs-t${fm ? ' fm' : ''}">${fm ? `<b>${L('决胜时刻', 'Final minute')}</b> <em>×${cup.fm}</em> ` : `<small>${L(`第 ${cup.n} 学期`, `Term ${cup.n}`)}</small> `}<span class="num">${countdown(cup.left)}</span></span>`;
    const ev = s?.ev ?? null;
    const next = ev && ev.nx !== undefined && !ev.id ? `<small class="cs-next">${L('下一件事', 'Next event')} <span class="num">${countdown(ev.nx)}</span></small>` : '';
    const boss = ev?.id === 'troll' && ev.st === 'on' && ev.m
      ? `<div class="cs-boss">${ic('troll')}<span class="bb-name">${L('巨怪', 'Mountain Troll')}</span><span class="bb-bar"><i style="width:${(bossFrac(ev) * 100).toFixed(1)}%"></i></span><span class="num">${ev.hp}/${ev.m}</span></div>`
      : '';
    setHtml(strip, `<div class="cs-row">${segs.slice(0, 2).join('')}${mid}${segs.slice(2).join('')}</div>${next}${boss}`);
    strip.classList.toggle('fm', fm);
    document.body.classList.toggle('boss', !!boss);
    strip.hidden = false;
  }

  // ------------------------------------------------------------------ the event slip + compass (under the clock)
  function renderSlip() {
    const clock = $('clock');
    if (!clock) return;
    const el = slot('evslip', () => clock.parentElement!, (e) => { ($('dl-compass') ?? clock).after(e); });
    if (!el.dataset.go) {
      // a tap on a live event walks you there (the 2026-09-30 phone playtest: one system of ten touched, mostly for want of the way)
      el.dataset.go = '1';
      el.addEventListener('click', () => {
        const ev = d.snap()?.ev, t = ev?.id && ev.st === 'on' ? evTarget(ev) : null;
        if (!ev?.id || !t) return;
        const ink = EVENT_INK[ev.id];
        d.walkTo(t.x, t.z);
        d.toast(L(`正在前往：${ink.zh}`, `On the way: ${ink.en}`));
      });
    }
    const s = d.snap(), p = d.myPos(), me = d.me();
    const ev = s?.ev;
    if (!ev?.id) { el.hidden = true; edge.hidden = true; return; }
    const ink = EVENT_INK[ev.id];
    if (ev.st !== 'on') {
      setHtml(el, `${ic(ink.icon)}<div class="es-t"><b>${esc(resultLine(ev))}</b></div>`);
      el.className = `es ${ev.st}`;
      el.hidden = false;
      edge.hidden = true;
      return;
    }
    const t = evTarget(ev);
    let dir = '';
    if (t && p) {
      const { dist, rot } = bearing(p, t, d.camYaw());
      dir = `<span class="es-d"><span class="arrow" style="transform:rotate(${rot.toFixed(2)}rad)">↑</span><span class="num">${fmtDist(dist)}</span></span>`;
    }
    let extra = '';
    const hint = p ? curfewHint(ev, p) : null;
    const f = me?.fun?.curfew;
    if (hint) {
      extra = `<small class="es-cf${hint.danger && hint.inside ? ' danger' : ''}">${hint.inside ? L('你在城堡里', 'you are in the castle') : L('你在城堡外，安全', 'you are outside the castle: safe')} · ${hint.k === 'filch' ? L('费尔奇', 'Filch') : L('洛丽丝夫人', 'Mrs Norris')} ${fmtDist(hint.d)}${hint.inCone && hint.inside ? ` · <b>${L('在他的灯光里！', 'in his lantern light!')}</b>` : ''}${f?.grace ? ` · ${L(`刚被抓过：${f.grace} 秒内不会再抓`, `just caught: safe for ${f.grace}s`)}` : ''}</small>`;
      edge.hidden = !(hint.inside && hint.danger);
      edge.classList.toggle('hot', hint.inCone);
    } else edge.hidden = true;
    setHtml(el, `${ic(ink.icon)}<div class="es-t"><b>${esc(L(ink.zh, ink.en))}</b> <span class="num es-left">${countdown(ev.left ?? 0)}</span><small>${esc(objective(ev))}</small>${extra}</div>${dir}`);
    el.className = `es on ev-${ev.id}`;
    el.hidden = false;
  }

  // ------------------------------------------------------------------ the ceremony
  function renderCeremony() {
    const c = d.snap()?.cup?.cer;
    if (!c || dismissed === c.term) { if (!c) cer.hidden = true; return; }
    if (shownTerm !== c.term) { shownTerm = c.term; setHtml(cer, ceremonyHtml(c)); }
    cer.hidden = false;
  }
  function ceremonyHtml(c: CeremonySnap) {
    const star = (icon: string, zh: string, en: string, s: { name: string; house: House; pts: number } | null) => s
      ? `<li>${ic(icon)}<span>${L(zh, en)}</span><b>${esc(s.name)}</b><small data-house="${s.house}">${houseName(s.house)} · <span class="num">${s.pts}</span> ${L('分', 'pts')}</small></li>` : '';
    const rows = HOUSES.map((h) => ({ h, p: c.points[h] ?? 0 })).sort((a, b) => b.p - a.p)
      .map((r, i) => `<li data-house="${r.h}" class="${r.h === c.winner ? 'win' : ''}"><span class="rk">${i + 1}</span>${ic(houseIcon(r.h))}<span>${houseName(r.h)}</span><b class="num">${r.p}</b></li>`).join('');
    return `<div class="cer-card" data-house="${c.winner ?? ''}">
      <div class="cer-banner">${ic('cup')}<h2>${c.winner ? L(`学院杯归${houseName(c.winner)}！`, `${c.winner} win the House Cup!`) : L('本学期没有学院得分', 'No house scored this term')}</h2><small>${L(`第 ${c.term} 学期结束 · 礼堂的旗帜换了颜色`, `End of term ${c.term} · the banners in the Great Hall change colour`)}</small></div>
      <ol class="cer-houses">${rows}</ol>
      <ul class="cer-stars">${star('star', '本学期 MVP', 'MVP of the term', c.mvp)}${star('stupefy', '最佳决斗者', 'Top duellist', c.duelist)}${star('target', '最佳猎手', 'Top hunter', c.hunter)}${star('snitch', '事件英雄', 'Event hero', c.hero)}</ul>
      ${c.minister ? `<p class="cer-min">${ic('seal')}${L(`新任魔法部长：<b>${esc(c.minister)}</b>`, `New Minister for Magic: <b>${esc(c.minister)}</b>`)}</p>` : ''}
      <p class="hint">${L('新学期开始了。点一下关闭。', 'A new term begins. Click to close.')}</p></div>`;
  }

  // ------------------------------------------------------------------ the card reveal
  function cardHtml(c: Card, owned = true, extra = '') {
    const r = RARITY_INK[c.rarity];
    const set = c.set ? CARD_SETS.find((s) => s.id === c.set) : null;
    if (!owned) return `<div class="fc ${r.cls} missing" data-card="${c.id}" title="${esc(L(`${r.zh} · 还没有`, `${r.en} · not yet`))}"><div class="fc-art"><span class="fc-mono">?</span></div><div class="fc-name">${L('？？？', '???')}</div><div class="fc-rar">${L(r.zh, r.en)}</div></div>`;
    return `<div class="fc ${r.cls}" data-card="${c.id}"><div class="fc-art"><span class="fc-mono">${esc(monogram(c))}</span>${ic('frog', 'fc-frog')}</div><div class="fc-name">${esc(L(c.zh, c.en))}</div><div class="fc-rar">${L(r.zh, r.en)}${set ? ` · ${esc(L(set.zh, set.en))}` : ''}</div>${extra}</div>`;
  }
  function startReveal() {
    if (!reveal.hidden || !queue.size) return;
    const n = queue.next()!;
    const c = CARD_BY_ID[n.id];
    if (!c) return;
    const back = `<div class="fc-back">${ic('frog')}<span>${L('巧克力蛙', 'Chocolate Frog')}</span></div>`;
    reveal.innerHTML = `<div class="cr-wrap${reduced() ? ' still' : ''}"><div class="cr-flip">${back}<div class="cr-front">${cardHtml(c, true, `<p class="fc-flav">${esc(L(c.flavour.zh, c.flavour.en))}</p>`)}</div></div>
      <p class="cr-cap">${n.dup ? L(`刚拿到 · 重复了，换成 ${({ common: 5, rare: 12, epic: 30, legendary: 80 } as const)[c.rarity]} 加隆`, `Just got · a duplicate: ${({ common: 5, rare: 12, epic: 30, legendary: 80 } as const)[c.rarity]} Galleons`) : L('刚拿到！按 C 打开画册', 'Just got! C opens your album')}</p></div>`;
    reveal.hidden = false;
    revealUntil = performance.now() + 6500;
    clearTimeout(revealTimer);
    revealTimer = window.setTimeout(endReveal, 6500);
  }
  function endReveal() {
    clearTimeout(revealTimer);
    reveal.hidden = true;
    revealUntil = 0;
    if (queue.size) setTimeout(startReveal, 300);
  }

  // ------------------------------------------------------------------ the album (C)
  function renderAlbum() {
    const me = d.me();
    const owned = me?.fun?.cards ?? [];
    const m = albumModel(owned, albumFilter);
    const pick = albumPick ? CARD_BY_ID[albumPick] : null;
    const tab = (k: typeof albumFilter, zh: string, en: string) => `<button type="button" class="ghost${albumFilter === k ? ' on' : ''}" data-af="${k}">${L(zh, en)}</button>`;
    album.innerHTML = `<h2>${ic('frog')}<span>${L('巧克力蛙画片', 'Chocolate Frog cards')} <small>${L(`${m.owned}/${m.total} 张 · <kbd>C</kbd>`, `${m.owned}/${m.total} · <kbd>C</kbd>`)}</small></span> <button class="x" data-close="album" title="Esc"><svg class="ic"><use href="#i-x"/></svg></button></h2>
      <p class="sub">${L('画片不卖：打怪偶尔掉落、校园事件的奖励、藏在宝箱里（按 F 打开）。重复的换成加隆；集齐一套得称号。', 'Never sold: creatures drop them now and then, events reward them, chests hide them (F opens one). Duplicates become Galleons; a full set earns a title.')}</p>
      ${(() => { const closed = new Set(d.snap()?.cup?.ch ?? CHESTS.map((c) => c.id)), left = CHESTS.filter((c) => closed.has(c.id)); return `<p class="sub al-chests">${ic('chest')}${L(`本学期还剩 ${left.length} 个宝箱，藏在：`, `${left.length} chests still closed this term, hidden at: `)}${left.map((c) => esc(L(c.zh, c.en))).join(L('、', ' · '))}</p>`; })()}
      <div class="al-tabs">${tab('all', '全部', 'All')}${tab('owned', '已有', 'Owned')}${tab('missing', '还缺', 'Missing')}</div>
      <div class="al-body"><div class="al-groups">${m.groups.filter((g) => g.cards.length).map((g) => `<section class="al-g"><h3>${esc(L(g.zh, g.en))} <small class="num">${g.have}/${g.of}</small>${g.reward.zh ? ` <small class="al-rw${g.have === g.of ? ' done' : ''}">${g.have === g.of ? ic('check') : ''}${esc(L(`称号「${g.reward.zh}」`, `title "${g.reward.en}"`))}</small>` : ''}</h3><div class="al-grid">${g.cards.map((x) => cardHtml(x.c, x.owned)).join('')}</div></section>`).join('')}</div>
      ${pick && owned.includes(pick.id) ? `<aside class="al-pick">${cardHtml(pick, true, `<p class="fc-flav">${esc(L(pick.flavour.zh, pick.flavour.en))}</p>`)}</aside>` : ''}</div>`;
  }
  album.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest('[data-af]') as HTMLElement | null;
    if (f) { albumFilter = f.dataset.af as typeof albumFilter; renderAlbum(); return; }
    if (t.closest('[data-close="album"]')) { album.hidden = true; return; }
    const c = t.closest('.fc:not(.missing)') as HTMLElement | null;
    if (c) { albumPick = c.dataset.card ?? null; renderAlbum(); }
  });
  function toggleAlbum(force?: boolean) {
    const show = force ?? album.hidden;
    if (show) { renderAlbum(); d.solo(album); }
    album.hidden = !show;
  }
  let albumSig = '';

  return {
    /** 10 Hz from main.ts' hud(). */
    hud() {
      renderStrip();
      renderSlip();
      renderCeremony();
      const sig = (d.me()?.fun?.cards ?? []).join(',');
      if (!album.hidden && sig !== albumSig) renderAlbum();
      albumSig = sig;
    },
    /** A world event: a card for you flips over (queued, one at a time). */
    onEvent(e: { id: number; type: string; to?: string; card?: string; text: string }) {
      if (e.type === 'card' && e.to && e.card && CARD_BY_ID[e.card]) {
        if (queue.push(e.id, e.card, /already have|已经有了/.test(e.text) || /duplicate/i.test(e.text))) startReveal();
      }
    },
    /** While the ceremony or a card reveal holds the centre, big banners go to the feed (one big thing at a time). */
    claimsCentre: () => !cer.hidden || performance.now() < revealUntil,
    keydown(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
      if (e.key === 'c' || e.key === 'C') { toggleAlbum(); return true; }
      return false;
    },
    closeTop(): boolean {
      if (!reveal.hidden) { endReveal(); return true; }
      if (!cer.hidden) { cer.hidden = true; dismissed = shownTerm; return true; }
      if (!album.hidden) { album.hidden = true; return true; }
      return false;
    },
    toggleAlbum,
    /** The chests nobody opened this term (for the 3D scene and the F prompt). */
    chestsOpen: () => d.snap()?.cup?.ch ?? CHESTS.map((c) => c.id),
    /** The minimap: the event's marker (a gold ring) and, with the Marauder's Map, Filch and Mrs Norris. */
    drawMinimap(g: CanvasRenderingContext2D, P: (x: number, z: number) => readonly [number, number]) {
      const ev = d.snap()?.ev;
      if (!ev?.id || ev.st !== 'on') return;
      const t = evTarget(ev);
      if (t) { const [a, b] = P(t.x, t.z); g.strokeStyle = '#a4741d'; g.lineWidth = 3; g.beginPath(); g.arc(a, b, 7, 0, 7); g.stroke(); }
      if (ev.p) for (const p of ev.p) { const [a, b] = P(p.x, p.z); g.fillStyle = p.k === 'filch' ? '#7a1418' : '#5b4a3a'; g.beginPath(); g.arc(a, b, p.k === 'filch' ? 4.5 : 3, 0, 7); g.fill(); }
    },
  };
}

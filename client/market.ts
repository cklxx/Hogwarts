/**
 * 咒语集市 — the spell market page of the parchment spellbook (kernel: src/kernel/market.ts).
 *
 * A spread laid over the open book: the left page lists the market (search, tag / element / sort, "castable at my
 * year", my own listings), the Ministry's 推荐 shelf, banned and promoted badges and your royalties today; the right
 * page reads one listing (source of any version, lineage, forks, stats) with copy / fork / (un)publish, and — when
 * nothing is selected — publishes one of your own spells. Talks to the server only through `send`:
 *   { t: 'market', op: 'browse', q?, tag?, element?, year?, sort?, mine?, limit?, offset? }   → { t: 'market', op: 'browse', r }
 *   { t: 'market', op: 'spell', id, v? }                                                     → { t: 'market', op: 'spell', r }
 *   { t: 'marketop', op: 'publish' | 'unpublish' | 'copy' | 'fork', … }                      → { t: 'market', op, r } (+ a fresh `book`)
 * main.ts hooks: a 集市 tab in the book's list, `onMessage` for `market` replies, `onError` while it is open.
 */
import './market.css';
import { L, lang, tr } from './i18n';
import { ELEMENT_ICON, ic, isLatin, spellIcon } from './ink';

/** A listing as World's market views return it (browseMarket / marketSpell cards). */
export interface MarketCard {
  id: string; v: number; name: string; incantation: string; author: string; handle: string; house: string;
  tags: string[]; effects: string[]; minYear: number; nodes: number; desc: { zh: string; en: string } | null;
  versions: number; copies: number; forks: number; casts: number; casters: number; popularity: number;
  parent?: { id: string; v: number; name: string; author: string };
  banned: boolean; promoted: boolean; yours: boolean; unpublished?: boolean;
}
export interface MarketDetail extends MarketCard {
  version: number; versionName: string; incantationOf: string; source: string | null; note?: string; bannedNote?: string;
  versionList: { v: number; name: string; at: number; nodes: number; minYear: number; tags: string[] }[];
  lineage: { id: string; v: number; name: string; author: string; unpublished?: boolean }[];
  forkList: { id: string; name: string; author: string }[];
  canCopy: { ok: boolean; why?: string; have?: { name: string; v: number } };
  canFork: { ok: boolean; why?: string };
}
interface Browse {
  total: number; offset: number; sort: string; listings: MarketCard[]; promoted: MarketCard[];
  banned: { id: string; name: string; author: string }[];
  rules: { royalties: boolean; dailyCap: number; perCasterPerDay: number; parentShare: number };
  you?: { earnedToday: number; cap: number; on: boolean; castersToday: number; listings: number; maxListings: number };
}
/** A spell of your own book, as the armory lists it. */
export interface BookSpell { id: string; name: string; builtin: boolean; effects: string[]; source: string; origin?: { author: string }; market?: { id: string; v: number; own?: boolean } }

export interface MarketHost {
  /** Send a message to the server. */
  send(o: unknown): void;
  /** Your year and your spellbook right now. */
  year(): number;
  spells(): BookSpell[];
  /** Called when the page opens or closes (main.ts keeps its own state in step). */
  onToggle?(open: boolean): void;
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const YEAR_ZH: Record<number, string> = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七' };
const yearText = (y: number) => L(`${YEAR_ZH[y] ?? y}年级`, `Year ${y}`);
const TAGS = ['bolt', 'heal', 'shield', 'nova', 'root', 'push', 'haste', 'disarm', 'summon', 'regen', 'cleanse', 'chain', 'storm', 'glamour', 'reveal', 'delayed'];
const TAG_ZH: Record<string, string> = {
  bolt: '飞弹', heal: '治疗', shield: '护盾', nova: '冲击波', root: '定身', push: '击退', haste: '加速', disarm: '缴械', summon: '召唤', regen: '持续治疗',
  cleanse: '驱散', chain: '连锁', storm: '风暴', glamour: '变形', reveal: '显形', delayed: '延迟', light: '光', say: '说话', patronus: '守护神', revive: '复苏', mend: '群疗', apparate: '幻影移形',
};
const ELEMENT_ZH: Record<string, string> = { arcane: '奥术', fire: '火', ice: '冰', lightning: '雷', light: '光明' };
const tagText = (t: string) => (ELEMENT_ZH[t] ? L(ELEMENT_ZH[t], t) : L(TAG_ZH[t] ?? t, t));
const nameHtml = (n: string) => `<span class="${isLatin(n) ? 'lat' : ''}">${esc(n)}</span>`;
/** The drawing of a listing: by what it does, a bolt by its element (the first element tag). */
const cardIcon = (c: { name: string; effects: string[]; tags: string[] }) => spellIcon(c.name, c.effects, c.tags.filter((t) => ELEMENT_ICON[t]).map((t) => `:${t}`).join(' '));
const descText = (d: MarketCard['desc']) => (d ? (lang === 'zh' ? d.zh || d.en : d.en || d.zh) : '');

export function createMarket(book: HTMLElement, host: MarketHost) {
  const root = document.createElement('div');
  root.className = 'mk';
  root.hidden = true;
  root.innerHTML = `
    <section class="page l mk-l">
      <h2><span>${L('咒语集市', 'The Spell Market')} <small class="lat">Mercatus Incantationum</small></span></h2>
      <p class="sub">${L('巫师们公开的咒语：读、抄、改编。别人施放你发布的咒语，你会得到一点声望。', 'Spells wizards share: read, copy, fork. When others cast what you published, you earn a little reputation.')}</p>
      <div class="mk-back row"><button type="button" class="ghost mk-close">${ic('book')}${L('回到咒语书', 'Back to the spellbook')}</button><span class="mk-roy hint" aria-live="polite"></span></div>
      <div class="mk-filters">
        <label class="fld mk-q"><small>${L('搜索', 'Search')}</small><input type="search" maxlength="60" placeholder="${esc(L('名字、作者、描述', 'name, author, description'))}"/></label>
        <select class="mk-tag" title="${esc(L('效果或元素', 'effect or element'))}"><option value="">${L('全部效果', 'Any effect')}</option>${TAGS.map((t) => `<option value="${t}">${esc(tagText(t))}</option>`).join('')}</select>
        <select class="mk-el" title="${esc(L('元素', 'element'))}"><option value="">${L('全部元素', 'Any element')}</option>${Object.keys(ELEMENT_ICON).map((e) => `<option value="${e}">${esc(tagText(e))}</option>`).join('')}</select>
        <select class="mk-sort"><option value="popular">${L('最热门', 'Popular')}</option><option value="new">${L('最新', 'Newest')}</option><option value="promoted">${L('推荐优先', 'Promoted first')}</option></select>
        <label class="mk-chk"><input type="checkbox" class="mk-mine-year"/>${L('我能用的', 'Castable at my year')}</label>
        <label class="mk-chk"><input type="checkbox" class="mk-mine"/>${L('我发布的', 'Mine')}</label>
      </div>
      <div class="mk-shelf" hidden></div>
      <ul class="mk-list" aria-label="${esc(L('集市里的咒语', 'Market spells'))}"></ul>
      <div class="mk-more row" hidden><button type="button" class="ghost mk-prev">←</button><span class="hint mk-page"></span><button type="button" class="ghost mk-next">→</button></div>
      <div class="folio">${L('— 集 —', '— m —')}</div>
    </section>
    <section class="page r mk-r">
      <div class="mk-detail"></div>
      <pre class="mk-out" aria-live="polite"></pre>
      <div class="folio r">${L('— 市 —', '— n —')}</div>
    </section>`;
  book.querySelector('.cols')?.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

  const PAGE = 20;
  let data: Browse | null = null;
  let detail: MarketDetail | null = null;
  let sel: string | null = null;
  let offset = 0;
  let forking = false;
  let timer = 0;

  const filters = () => ({
    q: $<HTMLInputElement>('.mk-q input').value.trim() || undefined,
    tag: $<HTMLSelectElement>('.mk-tag').value || undefined,
    element: $<HTMLSelectElement>('.mk-el').value || undefined,
    sort: $<HTMLSelectElement>('.mk-sort').value,
    year: $<HTMLInputElement>('.mk-mine-year').checked ? host.year() : undefined,
    mine: $<HTMLInputElement>('.mk-mine').checked || undefined,
  });
  const browse = () => host.send({ t: 'market', op: 'browse', ...filters(), limit: PAGE, offset });
  const read = (id: string, v?: number) => host.send({ t: 'market', op: 'spell', id, ...(v ? { v } : {}) });
  const out = (text: string, cls = '') => { const o = $('.mk-out'); o.textContent = text; o.className = `mk-out ${cls}`; };

  // ---------------------------------------------------------------- left page
  function badges(c: MarketCard) {
    return (c.promoted ? `<span class="mk-b promo" title="${esc(L('魔法部推荐', 'Recommended by the Ministry'))}">${ic('star')}${L('推荐', 'Featured')}</span>` : '')
      + (c.banned ? `<span class="mk-b ban" title="${esc(L('被法令禁用：施放会失效，仍可阅读', 'Banned by decree: it fizzles, but can be read'))}">${ic('seal')}${L('禁用', 'Banned')}</span>` : '')
      + (c.yours ? `<span class="mk-b mine">${L('我的', 'Mine')}</span>` : '')
      + (c.unpublished ? `<span class="mk-b off">${L('已下架', 'Unpublished')}</span>` : '')
      + (c.parent ? `<span class="mk-b fork" title="${esc(L(`改编自 ${c.parent.author} 的「${c.parent.name}」`, `Forked from ${c.parent.author}'s "${c.parent.name}"`))}">${ic('quill')}fork</span>` : '');
  }
  function renderList() {
    if (!data) return;
    const r = data;
    const you = r.you;
    $('.mk-roy').innerHTML = you
      ? `${ic('coin')}${L(`今日版税 <b class="num">+${you.earnedToday}</b> / ${you.cap} 声望 · ${you.castersToday} 位巫师施放 · 在架 ${you.listings}/${you.maxListings}`, `Royalties today <b class="num">+${you.earnedToday}</b> / ${you.cap} · ${you.castersToday} casters · ${you.listings}/${you.maxListings} listed`)}${you.on ? '' : L('（部长关闭了版税）', ' (royalties off by decree)')}`
      : '';
    const shelf = $('.mk-shelf');
    shelf.hidden = !r.promoted.length;
    shelf.innerHTML = r.promoted.length ? `<h3>${ic('star')}${L('推荐书架', 'The featured shelf')} <small class="hint">${L('魔法部推荐', 'by Ministry decree')}</small></h3><div class="mk-chips">${r.promoted.map((c) =>
      `<button type="button" class="mk-chip" data-id="${esc(c.id)}">${ic(cardIcon(c))}${nameHtml(c.name)}<small>${esc(c.author)}</small></button>`).join('')}</div>` : '';
    $('.mk-list').innerHTML = r.listings.length ? r.listings.map((c) => `<li data-id="${esc(c.id)}" class="${c.id === sel ? 'sel' : ''}${c.banned ? ' banned' : ''}" tabindex="0">`
      + `<span class="sp-ic">${ic(cardIcon(c))}</span><span class="sp-tx"><b>${nameHtml(c.name)} <small class="mk-v">v${c.v}</small></b>`
      + `<small>${esc(c.author)} · ${yearText(c.minYear)} · ${c.tags.map((t) => esc(tagText(t))).join(' · ') || '—'}</small>`
      + `<small class="mk-stats">${L(`抄 ${c.copies} · 改编 ${c.forks} · 施放 ${c.casters}`, `${c.copies} copies · ${c.forks} forks · ${c.casters} casters`)}</small></span>`
      + `<span class="mk-bs">${badges(c)}</span></li>`).join('')
      : `<li class="mk-empty">${L('这里还空着。发布第一个咒语吧：在右页选一个你自己写的咒语。', 'Nothing here yet. Publish the first: pick one of your own spells on the right.')}</li>`;
    const pages = Math.max(1, Math.ceil(r.total / PAGE));
    $('.mk-more').hidden = pages <= 1;
    $('.mk-page').textContent = `${Math.floor(r.offset / PAGE) + 1} / ${pages}`;
  }

  // ---------------------------------------------------------------- right page
  const slotSelect = (cls: string) => `<select class="${cls}"><option value="">${L('不放快捷栏', 'no hotbar slot')}</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${L(`${n} 号格`, `slot ${n}`)}</option>`).join('')}</select>`;
  function renderPublish() {
    // your own spells that may be published: custom, not a copy of someone else's (market copies are forked instead,
    // studied ones are their author's); one already in the market becomes its next version
    const mine = host.spells().filter((s) => !s.builtin && (s.market ? s.market.own : !s.origin));
    const opts = mine.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.market?.own ? L(`（已发布 v${s.market.v}：再发布就是新版本）`, ` (published v${s.market.v}: publishing makes a new version)`) : ''}</option>`).join('');
    $('.mk-detail').innerHTML = `<h3 class="pg-title">${L('发布你的咒语', 'Publish a spell of yours')} <small>${L('版本不可修改：再次发布就是 v2、v3……', 'Versions are immutable: publishing again makes v2, v3…')}</small></h3>`
      + (mine.length ? `<div class="mk-pub"><label class="fld"><small>${L('咒语', 'Spell')}</small><select class="mk-pub-spell">${opts}</select></label>`
        + `<label class="fld"><small>${L('中文简介', 'Chinese line')}</small><input class="mk-pub-zh" maxlength="140" placeholder="${esc(L('一句话说明它做什么', 'what it does, in Chinese'))}"/></label>`
        + `<label class="fld"><small>${L('英文简介', 'English line')}</small><input class="mk-pub-en" maxlength="140" placeholder="${esc(L('（可选）', 'what it does'))}"/></label>`
        + `<div class="row"><button type="button" class="mk-publish">${ic('scroll')}${L('发布到集市', 'Publish to the market')}</button></div>`
        + `<p class="hint">${L(`别人每天第一次施放你的咒语，你得 +${data?.rules.perCasterPerDay ?? 1} 声望（改编你的咒语被施放，你得 +${data?.rules.parentShare ?? 0.3}），每天最多 ${data?.rules.dailyCap ?? 20}。NPC 和你自己施放不算。`, `Each wizard's first cast of your spell each day earns you +${data?.rules.perCasterPerDay ?? 1} reputation (+${data?.rules.parentShare ?? 0.3} for a fork of it), at most ${data?.rules.dailyCap ?? 20} a day. NPCs and your own casts do not count.`)}</p></div>`
        : `<p>${L('你还没有自己写的咒语。在咒语书里写一个（或从模板开始），铸造之后就能发布。', 'You have no spells of your own yet. Write one in the spellbook (or start from a template); once forged it can be published.')}</p>`);
  }
  function renderDetail() {
    const d = detail;
    if (!d || d.id !== sel) { renderPublish(); return; }
    const vs = d.versionList.length > 1 ? `<select class="mk-ver">${d.versionList.map((x) => `<option value="${x.v}"${x.v === d.version ? ' selected' : ''}>v${x.v} · ${esc(x.name)}</option>`).join('')}</select>` : `<span class="mk-v">v${d.version}</span>`;
    const lineage = d.lineage.length ? `<p class="mk-line">${ic('quill')}${L('家谱', 'Lineage')}：${[`<b>${nameHtml(d.name)}</b>`, ...d.lineage.map((p) => `<button type="button" class="linky" data-id="${esc(p.id)}">${nameHtml(p.name)}</button> <small>${esc(p.author)}${p.unpublished ? L('（已下架）', ' (unpublished)') : ''}</small>`)].join(' ← ')}</p>` : '';
    const forks = d.forkList.length ? `<p class="mk-line">${ic('figures')}${L('改编', 'Forks')}：${d.forkList.map((f) => `<button type="button" class="linky" data-id="${esc(f.id)}">${nameHtml(f.name)}</button> <small>${esc(f.author)}</small>`).join('，')}</p>` : '';
    const acts = d.yours
      ? `<div class="row">${d.unpublished ? `<button type="button" class="mk-republish">${ic('scroll')}${L('重新上架', 'Publish again')}</button>` : `<button type="button" class="ghost mk-unpublish">${ic('x')}${L('下架', 'Unpublish')}</button>`}<span class="hint">${L('在咒语书里改好后再次发布，就是新版本。', 'Rework it in the spellbook and publish again for a new version.')}</span></div>`
      : `<div class="row mk-acts"><label class="fld mk-nm"><small>${L('抄本名', 'Copy name')}</small><input class="mk-name" maxlength="40" value="${esc(d.versionName)}"/></label>${slotSelect('mk-slot')}`
        + `<button type="button" class="mk-copy"${d.canCopy.ok ? '' : ' disabled'}>${ic('check')}${L('抄进咒语书', 'Copy into my book')}</button>`
        + `<button type="button" class="ghost mk-fork"${d.canFork.ok && d.source !== null ? '' : ' disabled'}>${ic('quill')}${L('改编', 'Fork')}</button></div>`
        + (d.canCopy.ok ? '' : `<p class="hint mk-why">${esc(tr(d.canCopy.why ?? ''))}</p>`);
    const fork = forking && !d.yours ? `<div class="mk-forkbox"><h3>${ic('quill')}${L('改编', 'Fork')} <small class="hint">${L('改动源码，以你的名字发布；家谱里会记下原作者。', 'Change the source and publish it as yours; the lineage keeps the original author.')}</small></h3>`
      + `<div class="row"><label class="fld"><small>${L('名字', 'Name')}</small><input class="mk-fname" maxlength="40" value="${esc(`${d.versionName} II`.slice(0, 40))}"/></label><label class="fld"><small>${L('简介', 'Line')}</small><input class="mk-fdesc" maxlength="140"/></label></div>`
      + `<textarea class="mk-fsrc" spellcheck="false">${esc(d.source ?? '')}</textarea><div class="row">${slotSelect('mk-fslot')}<button type="button" class="mk-dofork">${ic('scroll')}${L('发布改编', 'Publish the fork')}</button><button type="button" class="quiet mk-nofork">${L('取消', 'Cancel')}</button></div></div>` : '';
    $('.mk-detail').innerHTML = `<h3 class="pg-title">${ic(cardIcon(d))}${nameHtml(d.name)} <small>${esc(d.author)} · ${yearText(d.minYear)} · ${d.nodes} ${L('节点', 'nodes')}</small></h3>`
      + `<div class="mk-bs">${badges(d)}</div>`
      + (descText(d.desc) ? `<p class="mk-desc">${esc(descText(d.desc))}</p>` : '')
      + `<p class="mk-meta">${vs} <span class="lat mk-inc">${esc(d.incantationOf)}</span> · ${d.tags.map((t) => `<span class="tb">${esc(tagText(t))}</span>`).join('')}</p>`
      + (d.banned ? `<p class="mk-banned">${ic('seal')}${L('这个咒语被魔法部法令禁用了：任何人施放它（包括抄本和一字不差的同款）都会失效。邓布利多军否决那道法令就能解禁。', 'Banned by Ministry decree: casting it (any copy, or the same words) fizzles for everyone. A Dumbledore\'s Army veto of that decree lifts the ban.')}</p>` : '')
      + (d.source !== null ? `<pre class="mk-src">${esc(d.source)}</pre>` : `<p class="hint">${L('作者已下架：现在只有作者能读源码；已有的抄本仍署作者的名字。', 'Unpublished: only its author can read the source now; copies keep their attribution.')}</p>`)
      + `<p class="mk-stats hint">${L(`被抄 ${d.copies} 次 · 改编 ${d.forks} 个 · 别人施放 ${d.casts} 次（${d.casters} 人次）`, `${d.copies} copies · ${d.forks} forks · cast ${d.casts} times by others (${d.casters} caster-days)`)}</p>`
      + lineage + forks + acts + fork
      + `<p class="row"><button type="button" class="quiet mk-new">${ic('plus')}${L('发布我自己的咒语', 'Publish one of mine')}</button></p>`;
  }

  // ---------------------------------------------------------------- events
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest('button, li[data-id]') as HTMLElement | null;
    if (!b) return;
    if (b.classList.contains('mk-close')) { close(); return; }
    if (b.dataset.id && (b.matches('li, .mk-chip, .linky'))) { sel = b.dataset.id; forking = false; out(''); read(sel); renderList(); return; }
    if (b.classList.contains('mk-prev')) { offset = Math.max(0, offset - PAGE); browse(); return; }
    if (b.classList.contains('mk-next')) { if (data && offset + PAGE < data.total) { offset += PAGE; browse(); } return; }
    if (b.classList.contains('mk-new')) { sel = null; detail = null; forking = false; renderList(); renderDetail(); return; }
    if (b.classList.contains('mk-publish')) {
      const id = $<HTMLSelectElement>('.mk-pub-spell').value;
      host.send({ t: 'marketop', op: 'publish', spell: id, desc: { zh: $<HTMLInputElement>('.mk-pub-zh').value, en: $<HTMLInputElement>('.mk-pub-en').value } });
      return;
    }
    if (!detail) return;
    if (b.classList.contains('mk-copy')) {
      const slot = Number($<HTMLSelectElement>('.mk-slot').value) || undefined;
      host.send({ t: 'marketop', op: 'copy', id: detail.id, v: detail.version, name: $<HTMLInputElement>('.mk-name').value.trim() || undefined, slot });
    } else if (b.classList.contains('mk-fork')) { forking = true; renderDetail(); $<HTMLTextAreaElement>('.mk-fsrc')?.focus(); }
    else if (b.classList.contains('mk-nofork')) { forking = false; renderDetail(); }
    else if (b.classList.contains('mk-dofork')) {
      host.send({
        t: 'marketop', op: 'fork', id: detail.id, v: detail.version, source: $<HTMLTextAreaElement>('.mk-fsrc').value,
        name: $<HTMLInputElement>('.mk-fname').value.trim() || undefined, desc: lang === 'zh' ? { zh: $<HTMLInputElement>('.mk-fdesc').value } : { en: $<HTMLInputElement>('.mk-fdesc').value },
        slot: Number($<HTMLSelectElement>('.mk-fslot').value) || undefined,
      });
    } else if (b.classList.contains('mk-unpublish')) host.send({ t: 'marketop', op: 'unpublish', id: detail.id });
    else if (b.classList.contains('mk-republish')) {
      const s = host.spells().find((x) => x.market?.id === detail!.id);
      if (s) host.send({ t: 'marketop', op: 'publish', spell: s.id });
      else out(L('✗ 这个咒语已经不在你的咒语书里了，没法重新上架。', '✗ That spell is no longer in your book, so it cannot be published again.'), 'bad');
    }
  });
  root.addEventListener('keydown', (e) => {
    const li = (e.target as HTMLElement).closest('li[data-id]') as HTMLElement | null;
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); li.click(); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('mk-ver') && detail) { read(detail.id, Number((t as HTMLSelectElement).value)); return; }
    if (t.closest('.mk-filters')) { offset = 0; browse(); }
  });
  $('.mk-q input').addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => { offset = 0; browse(); }, 300); });

  // ---------------------------------------------------------------- API for main.ts
  function open() {
    root.hidden = false;
    book.classList.add('mk-on');
    host.onToggle?.(true);
    browse();
    renderDetail();
  }
  function close() {
    root.hidden = true;
    book.classList.remove('mk-on');
    host.onToggle?.(false);
  }
  const isOpen = () => !root.hidden && !book.hidden;
  /** A `{ t: 'market', op, r }` reply. */
  function onMessage(msg: { op: string; r: unknown }) {
    const r = msg.r as Record<string, unknown>;
    switch (msg.op) {
      case 'browse': data = r as unknown as Browse; renderList(); if (!sel) renderDetail(); break;
      case 'spell': detail = r as unknown as MarketDetail; sel = detail.id; renderDetail(); renderList(); break;
      case 'copy': {
        const c = r as { copied: { name: string; slot: number | null }; from: { author: string }; notes: string[] };
        out(`✓ ${L(`「${c.copied.name}」抄进了你的咒语书，署名 ${c.from.author}。`, `"${c.copied.name}" is in your book, credited to ${c.from.author}.`)}${c.copied.slot ? L(`按 ${c.copied.slot} 施放。`, ` Press ${c.copied.slot}.`) : ''}${c.notes.length ? '\n' + c.notes.map(tr).join('\n') : ''}`, 'good');
        if (detail) read(detail.id, detail.version);
        break;
      }
      case 'fork': {
        const f = r as { forked: { id: string; name: string }; parent: { name: string; author: string } };
        out(`✓ ${L(`改编「${f.forked.name}」已发布（源自 ${f.parent.author} 的「${f.parent.name}」），也在你的咒语书里了。`, `Your fork "${f.forked.name}" is published (from ${f.parent.author}'s "${f.parent.name}") and in your book.`)}`, 'good');
        forking = false; sel = f.forked.id; read(f.forked.id); browse();
        break;
      }
      case 'publish': {
        const p = r as { published: string; v: number; name: string; unchanged?: boolean };
        out(p.unchanged ? L(`「${p.name}」v${p.v} 已经是最新版本了。`, `"${p.name}" v${p.v} is already the current version.`) : `✓ ${L(`「${p.name}」v${p.v} 上架了。`, `"${p.name}" v${p.v} is in the market.`)}`, 'good');
        sel = p.published; read(p.published); browse();
        break;
      }
      case 'unpublish': out(`✓ ${L('已下架。已有的抄本仍署你的名字。', 'Unpublished. Existing copies keep your name.')}`, 'good'); if (detail) read(detail.id); browse(); break;
    }
  }
  /** An error from the server while the page is open: shown here (returns false when closed). */
  function onError(text: string) {
    if (!isOpen()) return false;
    out(text, 'bad');
    return true;
  }
  /** The book's spells changed (a copy landed): the publish form lists them. */
  function onBook() { if (isOpen() && !sel) renderDetail(); }
  return { open, close, isOpen, onMessage, onError, onBook };
}

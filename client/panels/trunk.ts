/**
 * 行囊 (T) and the curse banner (a ClientFeature, out of main.ts): your items — equip, unequip, destroy, a cursed
 * binding's countdown —, the shop of fixed presets (src/shared/shop.ts), and the banner that says what curse is on
 * you and how to end it (Finite Incantatem, Revelio). It reads the armory from every {t:'book'} reply and refreshes
 * it after anything that changes it (a cast, a curse arriving, a purchase).
 */
import { curseText, type HexState } from '../controls';
import type { FeatureContext } from '../context';
import type { ClientDeps, ClientFeature } from '../feature';
import { L, lang, tr } from '../i18n';
import { ic, itemIcon } from '../ink';
import { SHOP, shopPrice } from '../play';
import { esc } from './logic';

interface TrunkItem {
  id: string; name: string; slot: string; mods: Record<string, number>; lore?: string; charm?: unknown; unique?: string; equipped: boolean;
  cursed?: boolean; anon?: boolean; bound?: boolean; boundSecondsLeft?: number; jinx?: { kind: string; mag: number; seconds: number } | null; forgedByName?: string;
}
interface TMe { name: string; year: number; galleons: number; hex?: HexState | null }
const $ = (s: string) => document.querySelector(s) as HTMLElement;

export function trunkFeature(d: ClientDeps, ctx: FeatureContext): ClientFeature {
  const me = () => d.me() as TMe | null;
  const trunk = $('#trunk'), cursebar = $('#cursebar');
  /** When the trunk last asked the server for something: an 'err' right after is its. */
  let asked = -1e9;
  /** Private news of a curse (arrival, Finite, Revelio, wearing off), shown in the banner for a few seconds. */
  let curseNews: { text: string; until: number } | null = null;

  function renderCurseBar() {
    const el = cursebar;
    const c = curseText(me()?.hex);
    if (curseNews && performance.now() > curseNews.until) curseNews = null;
    if ((!c || (!c.hexed && !c.respite)) && !curseNews) { el.hidden = true; return; }
    if (!el.firstElementChild) {
      el.innerHTML = `<div class="cb-news"></div><div class="cb-text"></div><div class="cb-acts"><button data-act="finite">${L('咒立停', 'Finite Incantatem')}</button> <button class="ghost" data-act="revelio">${L('原形立现', 'Revelio')}</button> <button class="ghost" data-act="trunk">${L('行囊', 'Trunk')} <kbd>T</kbd></button></div>`;
    }
    const hexed = !!c?.hexed;
    el.classList.toggle('quiet', !hexed && !curseNews);
    el.classList.toggle('news', !hexed && !!curseNews);
    const news = el.querySelector('.cb-news') as HTMLElement;
    const nt = curseNews?.text ?? '';
    if (news.textContent !== nt) news.textContent = nt;
    news.hidden = !nt;
    // fresh news already says how to end it and how to find out who: the banner then lists only what is on you
    const text = hexed
      ? `<b>${esc(c!.head)}</b>${c!.parts.map(esc).join(' · ')}${L('。', '.')}${curseNews ? '' : `<br/>${esc(c!.cure)} ${esc(c!.who)}`}${c!.resting ? `<br/>${esc(c!.resting)}` : ''}`
      : curseNews ? '' : esc(c?.respite ?? '');
    const t = el.querySelector('.cb-text') as HTMLElement;
    if (t.innerHTML !== text) t.innerHTML = text;
    t.hidden = !text;
    (el.querySelector('.cb-acts') as HTMLElement).hidden = !hexed && !curseNews;
    const fin = el.querySelector('[data-act="finite"]') as HTMLButtonElement;
    const why = finiteBlocked();
    fin.disabled = !!why;
    fin.title = why ?? '';
    el.hidden = false;
  }
  ctx.on(cursebar, 'click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    if (b.dataset.act === 'finite') d.castOnSelf('Finite Incantatem');
    if (b.dataset.act === 'revelio') d.castOnSelf('Revelio');
    if (b.dataset.act === 'trunk') toggleTrunk(true);
  });

  // ------------------------------------------------------------------ the trunk (T): equip, unequip, destroy; break a cursed binding (§C.6)
  let trunkItems: TrunkItem[] = [];
  let trunkAt = 0;
  let knownSpells: Set<string> | null = null;
  let trunkMsg = '';
  let destroyArmed: string | null = null;
  let trunkRefetch = 0;
  /** The armory has arrived at least once (so an empty trunk really is empty). */
  let trunkKnown = false;
  let trunkOk = false;
  const SLOT_ZH: Record<string, string> = { wand: '魔杖', robe: '长袍', amulet: '护身符', trinket: '小饰物', broom: '扫帚' };
  const MOD_ZH: Record<string, string> = { maxHp: '生命上限', maxMana: '法力上限', manaRegen: '回蓝', speed: '移速', power: '威力', ward: '护甲' };
  function onArmory(armory: { items?: TrunkItem[]; spells?: { name: string }[] }) {
    if (Array.isArray(armory.items)) { trunkItems = armory.items; trunkAt = performance.now(); trunkKnown = true; }
    if (Array.isArray(armory.spells)) knownSpells = new Set(armory.spells.map((s) => s.name));
    renderTrunk(true);
  }
  const knows = (name: string, year: number) => knownSpells ? knownSpells.has(name) : (me()?.year ?? 1) >= year;
  /** Why Finite Incantatem cannot be cast from the trunk or the banner, or null. */
  function finiteBlocked(): string | null {
    return knows('Finite Incantatem', 2) ? null : L('你还不会「咒立停」：需 2 年级', 'You do not know Finite Incantatem yet: needs year 2');
  }
  function boundLeft(it: TrunkItem): number {
    const live = me()?.hex?.bound?.find((b) => b.id === it.id);
    if (live) return live.left;
    if (!it.bound) return 0;
    return Math.max(0, Math.ceil((it.boundSecondsLeft ?? 0) - (performance.now() - trunkAt) / 1000));
  }
  function modsText(m: Record<string, number>) {
    return Object.entries(m ?? {}).filter(([, v]) => v).map(([k, v]) => `<span class="${v < 0 ? 'neg' : 'pos'}">${esc(L(MOD_ZH[k] ?? k, k))} ${v > 0 ? '+' : ''}${v}</span>`).join(' ');
  }
  function renderTrunk(rebuild = false) {
    const el = trunk;
    if (el.hidden) return;
    if (rebuild) {
      const fin = finiteBlocked(), rev = knows('Revelio', 1) ? null : L('你还不会「原形立现」', 'You do not know Revelio yet');
      $('#trunk-cure').innerHTML = `<button data-act="finite"${fin ? ` disabled title="${esc(fin)}"` : ''}>${ic('finite')}${L('念咒立停解咒', 'Cast Finite Incantatem to break curses')}</button>${fin ? ` <span class="hint">${esc(fin)}</span>` : ''}
        <button class="ghost" data-act="revelio"${rev ? ` disabled title="${esc(rev)}"` : ''}>${ic('eye')}${L('念原形立现，看看是谁', 'Cast Revelio: who sent it?')}</button>`;
      $('#trunk-list').innerHTML = trunkItems.length ? trunkItems.map((it) => {
        const bound = boundLeft(it) > 0;
        const badges = [
          it.equipped ? `<span class="tb eq">${L('已穿戴', 'equipped')}</span>` : '',
          it.cursed ? (bound ? `<span class="tb curse">🔒 ${L('被诅咒（粘身，剩', 'cursed (stuck,')} <b data-bound="${esc(it.id)}">${boundLeft(it)}</b> ${L('秒）', 's left)')}</span>` : `<span class="tb curse">☠️ ${L('被诅咒', 'cursed')}</span>`) : '',
          it.jinx ? `<span class="tb curse">🕸️ ${L('带恶咒', 'jinxed')}</span>` : '',
          it.anon ? `<span class="tb anon">✉️ ${L('匿名寄来', 'anonymous')}</span>` : it.forgedByName && it.forgedByName !== me()?.name && it.forgedByName !== 'Legend' ? `<span class="tb">${L('寄件人', 'from')} ${esc(it.forgedByName)}</span>` : '',
        ].join(' ');
        const stuck = bound ? ` disabled title="${esc(L('粘身中：先念咒立停，或等它消退', 'Stuck: cast Finite Incantatem first, or wait'))}"` : '';
        const wear = it.equipped ? `<button class="ghost" data-act="unequip" data-slot="${esc(it.slot)}"${stuck}>${L('卸下', 'Unequip')}</button>` : `<button class="ghost" data-act="equip" data-id="${esc(it.id)}">${L('穿上', 'Equip')}</button>`;
        const del = it.unique === 'elder_wand' ? '' : destroyArmed === it.id
          ? `<button data-act="destroy-yes" data-id="${esc(it.id)}">${L('确定销毁', 'Destroy it')}</button> <button class="ghost" data-act="destroy-no">${L('取消', 'Cancel')}</button>`
          : `<button class="ghost" data-act="destroy" data-id="${esc(it.id)}"${stuck}>${L('销毁', 'Destroy')}</button>`;
        return `<li class="${it.cursed ? 'cursed' : ''}"><span class="it-ic">${ic(itemIcon(it.slot))}</span><div class="ti-name"><b>${esc(it.name)}</b> <span class="hint">${esc(L(SLOT_ZH[it.slot] ?? it.slot, it.slot))}</span> ${badges}</div>
          <div class="ti-mods">${modsText(it.mods)}${it.lore ? ` <i class="hint">“${esc(it.lore)}”</i>` : ''}</div><div class="ti-acts">${wear} ${del}</div></li>`;
      }).join('') : `<li class="hint">${L('箱子是空的。在下面的商店买一件，或者让你的 Agent 用 forge_item 给你锻造。', 'Your trunk is empty. Buy something in the shop below, or ask your agent to forge you something (forge_item).')}</li>`;
      $('#trunk-msg').textContent = trunkMsg;
      $('#trunk-msg').className = trunkOk ? 'ok' : 'err';
      renderShop();
    } else if (shopSig !== `${me()?.galleons}`) renderShop();
    // live countdowns; once a binding wears off, ask for a fresh list
    document.querySelectorAll<HTMLElement>('#trunk-list [data-bound]').forEach((b) => {
      const it = trunkItems.find((x) => x.id === b.dataset.bound);
      const left = it ? boundLeft(it) : 0;
      b.textContent = String(left);
      if (left <= 0 && performance.now() - trunkRefetch > 2000) { trunkRefetch = performance.now(); d.send({ t: 'book' }); }
    });
  }
  function toggleTrunk(force?: boolean) {
    const t = trunk;
    t.hidden = !(force ?? t.hidden);
    if (!t.hidden) { d.solo(t); trunkMsg = ''; destroyArmed = null; d.send({ t: 'book' }); renderTrunk(true); }
  }
  function onTrunkError(text: string) {
    if (performance.now() - asked > 3000 || trunk.hidden) return false;
    trunkMsg = text;
    d.send({ t: 'book' });
    return true;
  }
  ctx.on(trunk, 'click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    trunkMsg = '';
    asked = performance.now();
    if (act === 'close') { toggleTrunk(false); return; }
    trunkOk = false;
    if (act === 'finite') { d.castOnSelf('Finite Incantatem'); return; }
    if (act === 'revelio') { d.castOnSelf('Revelio'); return; }
    if (act === 'buy') { d.send({ t: 'buy', item: b.dataset.item, lang }); b.disabled = true; return; }
    if (act === 'equip') d.send({ t: 'equip', item: b.dataset.id });
    else if (act === 'unequip') d.send({ t: 'unequip', slot: b.dataset.slot });
    else if (act === 'destroy') { destroyArmed = b.dataset.id ?? null; renderTrunk(true); return; }
    else if (act === 'destroy-no') { destroyArmed = null; renderTrunk(true); return; }
    else if (act === 'destroy-yes') { destroyArmed = null; d.send({ t: 'destroy', item: b.dataset.id }); }
    else return;
    d.send({ t: 'book' }); // the server does not answer equip / unequip / destroy: read the trunk again
  });

  // ------------------------------------------------------------------ the shop (in the trunk): fixed presets, forged for yourself (src/shared/shop.ts)
  let shopSig = '';
  function renderShop() {
    const g = me()?.galleons ?? 0;
    shopSig = `${me()?.galleons}`;
    $('#shop').innerHTML = `<h3>${ic('coin')}${L('商店', 'Shop')} <small>${L(`你有 <span class="num">${g}</span> 加隆 · 买下自动穿上 · 打败魔物赚加隆`, `you have <span class="num">${g}</span> Galleons · worn at once · creatures drop Galleons`)}</small></h3><ul class="shop-list">` +
      SHOP.map((s) => {
        const price = shopPrice(s), can = g >= price;
        return `<li><span class="it-ic">${ic(itemIcon(s.slot))}</span><div class="ti-name"><b>${esc(L(s.zh, s.en))}</b> <span class="hint">${esc(L(SLOT_ZH[s.slot] ?? s.slot, s.slot))}</span></div>
          <div class="ti-mods">${modsText(s.mods)} <i class="hint">“${esc(L(s.lore.zh, s.lore.en))}”</i></div>
          <div class="ti-acts"><button data-act="buy" data-item="${esc(s.key)}"${can ? '' : ' disabled'}>${L(`<span class="num">${price}</span> 加隆 · 购买`, `Buy · <span class="num">${price}</span> Galleons`)}</button>${can ? '' : ` <span class="hint">${L(`还差 ${price - g} 加隆`, `${price - g} more Galleons`)}</span>`}</div></li>`;
      }).join('') + '</ul>';
  }
  function onBought(r: { item: string; equipped: boolean; notes: string[] }) {
    trunkOk = true;
    trunkMsg = `✓ ${L(`买下了「${r.item}」`, `Bought "${r.item}"`)}${r.equipped ? L('，已经穿上。', ', now wearing it.') : L('：在上面点「穿上」。', ': press Equip above.')} ${tr(r.notes[0] ?? '')}`;
    renderTrunk(true);
  }

  return {
    id: 'trunk',
    widgets: [{ id: 'cursebar', zh: '诅咒横幅', en: 'Curse banner' }],
    hud() { renderCurseBar(); renderTrunk(); },
    // the next-goal line: "buy your first item" until the trunk holds one
    goal: () => ({ items: trunkKnown ? trunkItems.length : null }),
    observe(msg) {
      if (msg.t === 'book') onArmory(msg.armory as { items?: TrunkItem[]; spells?: { name: string }[] });
      else if (msg.t === 'cast' && !trunk.hidden) d.send({ t: 'book' }); // Finite Incantatem / Revelio change what the trunk shows
    },
    onMessage(msg) {
      if (msg.t !== 'bought') return false;
      onBought(msg.r as { item: string; equipped: boolean; notes: string[] });
      return true;
    },
    onEvent(e, fresh) {
      // a curse addressed to you belongs to the banner (and the trunk), not to the feed (main.ts leaves it out)
      if (e.type !== 'curse' || !e.to || !fresh) return;
      curseNews = { text: lang === 'zh' && e.zh ? e.zh : e.text, until: performance.now() + 12000 };
      if (!trunk.hidden) d.send({ t: 'book' });
    },
    onError: onTrunkError,
    keydown(e) {
      if (e.key !== 't' && e.key !== 'T') return false;
      if (!e.repeat) toggleTrunk();
      return true;
    },
    close() { if (trunk.hidden) return false; toggleTrunk(false); return true; },
    open(what) { if (what !== 'trunk') return false; toggleTrunk(true); return true; },
  };
}

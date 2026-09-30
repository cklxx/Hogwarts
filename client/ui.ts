/**
 * 界面 (a ClientFeature): the HUD is yours to arrange. Every piece of it — main.ts's and each feature's (`widgets`) —
 * can be hidden, dragged somewhere else (U, or the 界面 sheet in the Owl Post) and put back; the paper can be one of
 * three themes; and your own CSS goes on top. All of it lives in this browser only (localStorage `hw-ui`), per viewer,
 * never on the server.
 *
 * A widget is a HUD element by id. Moving one sets its CSS `translate` (an offset from where the layout puts it, so
 * it still follows the window), hiding one sets `data-ui-off`; both are re-applied at 10 Hz to elements that a panel
 * made (or remade) since, which costs one attribute read per widget when nothing changed.
 */
import { ic } from './ink';
import { L } from './i18n';
import type { ClientDeps, ClientFeature, ClientWidget } from './feature';
import type { FeatureContext } from './context';
import './ui.css';

export const UI_KEY = 'hw-ui';
export const THEMES = ['parchment', 'night', 'contrast'] as const;
export type Theme = (typeof THEMES)[number];
export interface Layout { theme: Theme; off: string[]; at: Record<string, [number, number]>; css: string }
export const CSS_MAX = 20000;

/** The HUD pieces main.ts draws (a feature lists its own in `widgets`). */
export const BASE_WIDGETS: readonly ClientWidget[] = [
  { id: 'me', zh: '身份卡', en: 'Your card' },
  { id: 'agentbox', zh: 'Agent 状态', en: 'Agent status' },
  { id: 'goal', zh: '下一步', en: 'Next goal' },
  { id: 'clock', zh: '时钟', en: 'Clock' },
  { id: 'feed', zh: '消息', en: 'News feed' },
  { id: 'minimap', zh: '小地图', en: 'Minimap' },
  { id: 'bars', zh: '生命 · 法力 · 快捷栏', en: 'Health, mana, hotbar' },
  { id: 'help', zh: '按键提示', en: 'Key hints' },
  { id: 'pn-top', zh: '顶部横幅', en: 'Top ribbons' },
  { id: 'cupstrip', zh: '学院杯', en: 'House Cup' },
  { id: 'evslip', zh: '校园事件', en: 'School event' },
  { id: 'touchbar', zh: '触屏按钮', en: 'Touch buttons' },
];

/** Keep what is well-formed of a stored layout (it may be old, hand-edited, or someone else's). */
export function parseLayout(raw: unknown): Layout {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const at: Layout['at'] = {};
  if (o.at && typeof o.at === 'object') for (const [k, v] of Object.entries(o.at as Record<string, unknown>)) {
    if (/^[\w-]{1,40}$/.test(k) && Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) at[k] = [clampPx(v[0]), clampPx(v[1])];
  }
  return {
    theme: THEMES.includes(o.theme as Theme) ? (o.theme as Theme) : 'parchment',
    off: Array.isArray(o.off) ? o.off.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)).slice(0, 60) : [],
    at,
    css: typeof o.css === 'string' ? o.css.slice(0, CSS_MAX) : '',
  };
}
const clampPx = (n: number) => Math.max(-4000, Math.min(4000, Math.round(n)));

/**
 * Your CSS, minus what could carry the page's secrets away: no @import, no url() but data: and this server's own
 * paths (an attribute selector plus a remote background is enough to read a field one character at a time).
 */
export function safeCss(css: string): string {
  return css.slice(0, CSS_MAX)
    .replace(/\\/g, '') // no escapes: u\72l( is url(
    .replace(/@import[^;]*;?/gi, '/* import removed */')
    .replace(/(?:-webkit-)?image-set\(|\bsrc\(/gi, 'none(')
    .replace(/url\(\s*(?!['"]?\s*(?:data:|\/(?!\/)))[^)]*\)/gi, 'none /* url removed */')
    .replace(/(['"])[^'"]*\/\/[^'"]*\1/g, '""') // and no quoted address left for some newer function to fetch
    .replace(/<\/?style/gi, '');
}

function load(): Layout {
  try { return parseLayout(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}')); } catch { return parseLayout({}); }
}

export function uiFeature(d: ClientDeps, ctx: FeatureContext): ClientFeature {
  let lay = load(), editing = false, rev = 1;
  ctx.keep('editing', () => editing, (s) => { editing = s; });
  const save = () => { rev++; try { localStorage.setItem(UI_KEY, JSON.stringify(lay)); } catch { /* private mode: this tab only */ } };
  let all: ClientWidget[] | null = null;
  const widgets = () => (all ??= [...BASE_WIDGETS, ...d.features().flatMap((f) => f.widgets ?? [])]);
  const name = (w: ClientWidget) => L(w.zh, w.en);

  let userStyle: HTMLStyleElement | null = null;
  function applyGlobal() {
    const root = document.documentElement;
    if (lay.theme === 'parchment') delete root.dataset.theme; else root.dataset.theme = lay.theme;
    if (lay.css && !userStyle) { userStyle = ctx.own(document.createElement('style')); userStyle.id = 'ui-user'; document.head.append(userStyle); }
    if (userStyle) userStyle.textContent = safeCss(lay.css);
    document.body.classList.toggle('ui-edit', editing);
  }
  /** Each widget as the layout says, if it is not already (the stamp is the layout's revision and the element). */
  function applyWidgets() {
    for (const w of widgets()) {
      const el = document.getElementById(w.id);
      if (!el) continue;
      const stamp = `${rev}${editing ? 'e' : ''}`;
      if (el.dataset.uiRev === stamp) continue;
      el.dataset.uiRev = stamp;
      el.dataset.uiName = name(w);
      const off = lay.off.includes(w.id), at = lay.at[w.id];
      if (off) el.dataset.uiOff = ''; else delete el.dataset.uiOff;
      el.style.translate = at ? `${at[0]}px ${at[1]}px` : '';
    }
  }

  // ------------------------------------------------------------------ edit mode: drag a widget, double-click to hide or show it
  let drag: { id: string; el: HTMLElement; x0: number; y0: number; at0: [number, number] } | null = null;
  const widgetAt = (t: EventTarget | null) => {
    const ids = new Set(widgets().map((w) => w.id));
    for (let el = t as HTMLElement | null; el; el = el.parentElement) if (ids.has(el.id)) return el;
    return null;
  };
  ctx.on(window, 'pointerdown', (e) => {
    if (!editing) return;
    const el = widgetAt(e.target);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    drag = { id: el.id, el, x0: e.clientX, y0: e.clientY, at0: lay.at[el.id] ?? [0, 0] };
    el.setPointerCapture?.(e.pointerId);
  }, { capture: true });
  ctx.on(window, 'pointermove', (e) => {
    if (!drag) return;
    const x = drag.at0[0] + e.clientX - drag.x0, y = drag.at0[1] + e.clientY - drag.y0;
    drag.el.style.translate = `${x}px ${y}px`;
  }, { capture: true });
  ctx.on(window, 'pointerup', (e) => {
    if (!drag) return;
    const x = drag.at0[0] + e.clientX - drag.x0, y = drag.at0[1] + e.clientY - drag.y0;
    if (Math.abs(x) + Math.abs(y) < 2) delete lay.at[drag.id]; else lay.at[drag.id] = [clampPx(x), clampPx(y)];
    drag = null;
    save(); applyWidgets();
  }, { capture: true });
  ctx.on(window, 'click', (e) => { if (editing && widgetAt(e.target)) { e.preventDefault(); e.stopPropagation(); } }, { capture: true }); // nothing acts while you arrange
  ctx.on(window, 'dblclick', (e) => {
    const el = editing ? widgetAt(e.target) : null;
    if (!el) return;
    toggleOff(el.id);
  }, { capture: true });
  const toggleOff = (id: string) => { lay.off = lay.off.includes(id) ? lay.off.filter((x) => x !== id) : [...lay.off, id]; save(); applyWidgets(); renderSheet(); };

  function setEditing(on: boolean) {
    editing = on;
    if (on) sheet().hidden = true;
    d.toast(on ? L('布局模式：拖动面板换位置，双击隐藏 / 显示；U 或 Esc 结束', 'Layout mode: drag panels to move them, double-click to hide or show; U or Esc to finish') : L('布局已保存（只在这台浏览器）', 'Layout saved (this browser only)'));
    rev++; applyGlobal(); applyWidgets();
  }

  // ------------------------------------------------------------------ the 界面 sheet
  let el: HTMLElement | null = null;
  const sheet = () => {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'uipanel'; el.className = 'sheet'; el.hidden = true;
    document.getElementById('hud')!.append(ctx.own(el));
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button, input') as HTMLElement | null;
      if (!b) return;
      if (b.dataset.theme) { lay.theme = b.dataset.theme as Theme; save(); applyGlobal(); renderSheet(); }
      if (b.dataset.off) toggleOff(b.dataset.off);
      if (b.dataset.do === 'edit') setEditing(true);
      if (b.dataset.do === 'reset') { lay = parseLayout({ css: lay.css }); save(); applyGlobal(); applyWidgets(); renderSheet(); }
      if (b.dataset.do === 'css') { lay.css = (el!.querySelector('textarea') as HTMLTextAreaElement).value.slice(0, CSS_MAX); save(); applyGlobal(); d.toast(L('自定义样式已应用', 'Your CSS is on')); }
      if (b.dataset.do === 'close') el!.hidden = true;
    });
    return el;
  };
  function renderSheet() {
    const s = sheet();
    if (s.hidden) return;
    const present = widgets().filter((w) => document.getElementById(w.id));
    const themeName: Record<Theme, [string, string]> = { parchment: ['羊皮纸', 'Parchment'], night: ['夜读', 'Night'], contrast: ['高对比', 'High contrast'] };
    s.innerHTML = `<h2>${ic('eye')}<span>${L('界面', 'Interface')} <small>${L('只在这台浏览器生效', 'this browser only')}</small></span><button class="x" data-do="close" title="Esc"><svg class="ic"><use href="#i-x"/></svg></button></h2>
      <h3>${L('主题', 'Theme')}</h3>
      <p>${THEMES.map((t) => `<button type="button" data-theme="${t}" class="${lay.theme === t ? '' : 'ghost'}">${L(...themeName[t])}</button>`).join(' ')}</p>
      <h3>${L('面板', 'Panels')}</h3>
      <p class="ui-list">${present.map((w) => `<label><input type="checkbox" data-off="${w.id}"${lay.off.includes(w.id) ? '' : ' checked'}/> ${name(w)}${lay.at[w.id] ? ` <small>${L('已移动', 'moved')}</small>` : ''}</label>`).join('')}</p>
      <p><button type="button" data-do="edit">${L('拖动布局', 'Arrange')} <kbd>U</kbd></button> <button type="button" class="ghost" data-do="reset">${L('恢复默认布局', 'Default layout')}</button></p>
      <h3>${L('自定义样式（CSS）', 'Your own CSS')}</h3>
      <p class="hint">${L('写在这里的 CSS 叠加在游戏样式上，比如 <code>#feed { opacity: .6 }</code> 或 <code>:root { --wax: #1f5f8b }</code>。外部链接和 @import 会被去掉。', 'CSS written here goes on top of the game\'s, e.g. <code>#feed { opacity: .6 }</code> or <code>:root { --wax: #1f5f8b }</code>. Remote url() and @import are removed.')}</p>
      <textarea spellcheck="false" rows="6" maxlength="${CSS_MAX}"></textarea>
      <p><button type="button" data-do="css">${L('应用', 'Apply')}</button></p>`;
    (s.querySelector('textarea') as HTMLTextAreaElement).value = lay.css;
  }
  const toggleSheet = (force?: boolean) => {
    const s = sheet();
    const show = force ?? s.hidden;
    if (show) { d.solo(s); s.hidden = false; renderSheet(); } else s.hidden = true;
  };
  ctx.on(document, 'click', (e) => { if ((e.target as HTMLElement).closest('[data-pn="ui"]')) toggleSheet(true); });

  applyGlobal();
  return {
    id: 'ui',
    hud: applyWidgets,
    keydown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
      if (editing && e.key === 'Escape') { setEditing(false); return true; }
      if (e.key !== 'u' && e.key !== 'U') return false;
      setEditing(!editing);
      return true;
    },
    close() {
      if (editing) { setEditing(false); return true; }
      if (el && !el.hidden) { el.hidden = true; return true; }
      return false;
    },
    menu: () => `<button type="button" class="ghost" data-pn="ui">${ic('eye')}${L('界面', 'Interface')} <kbd>U</kbd></button> `,
  };
}

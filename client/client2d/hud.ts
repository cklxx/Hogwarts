/**
 * 2D HUD: DOM overlay + canvas minimap for the Canvas 2D client.
 *
 * Everything renders from one snapshot via updateHUD(snap). The overlay never
 * blocks canvas input (pointer-events: none; only hotbar slots re-enable it).
 * No external CSS framework: all styles are injected by mountHUD().
 */
import { WORLD_HALF } from '../../src/shared/map.js';

// ------------------------------------------------------------------ types

/** One fate chain, mirrored from kernel/fates.ts FateThread (defensive: extra fields ignored). */
export interface HudFate {
  id: string;
  zh: string;
  state: 'saved' | 'lost' | 'open';
  deadlineDay: number;
  hint?: string;
}

/** One hotbar slot, mirroring the server's 'me' hotbar shape. */
export interface HudSlot {
  id: string;
  name: string;
  mana?: number | null;
  cd: number;
  kind?: 'harm' | 'help' | 'self';
}

/** Everything updateHUD() reads. warweek.ts is not written yet: day/total
 *  follow the assumed world.warweek = { day: number } shape. */
export interface HudSnapshot {
  me: { handle: string; x: number; z: number; hp: number; maxHp: number; mana: number; maxMana: number };
  wizards: { h: string; x: number; z: number }[];
  creatures: { x: number; z: number; hostile: boolean }[];
  hotbar: (HudSlot | null)[];
  selected: number;
  warweek?: { day: number; total?: number };
  fates?: HudFate[];
  worldHalf?: number;
}

// ------------------------------------------------------------------ mount

const CSS = `
#hud2d{position:absolute;inset:0;pointer-events:none;z-index:10;font-family:ui-monospace,Menlo,Consolas,monospace;color:#e8e2d4;font-size:13px;line-height:1.5;user-select:none}
#hud2d .panel{background:rgba(10,8,16,.72);border:1px solid rgba(232,226,212,.22);border-radius:6px;backdrop-filter:blur(2px)}
#ww{position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:6px 18px;text-align:center;min-width:220px}
#ww .day{font-size:18px;letter-spacing:2px;font-weight:700}
#ww .bar{height:6px;margin-top:6px;background:rgba(232,226,212,.15);border-radius:3px;overflow:hidden}
#ww .bar i{display:block;height:100%;background:#c9a227;border-radius:3px;transition:width .4s}
#ww.final .day{color:#ff5a5a;animation:pulse 1s infinite}
#ww.final .bar i{background:#ff5a5a}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
#fates{position:absolute;top:10px;right:10px;padding:8px 12px;max-width:240px;font-size:12px}
#fates .ft{margin-top:4px;opacity:.9;pointer-events:auto;cursor:pointer}
#fates .ft.saved{color:#7fd97f}#fates .ft.lost{color:#ff7f7f}
#fates .ft .ic{display:inline-block;width:16px;text-align:center;font-weight:700}
#fates .ft.saved .ic{color:#c9a227}#fates .ft.lost .ic{color:#5a5a5a}#fates .ft.open .ic{color:#e8e2d4}
#fates .ft .dl{color:#c9a227;font-size:11px;white-space:nowrap}
#fates .ft.urg{border:1px solid rgba(255,90,90,.55);border-radius:4px;padding:2px 4px;margin-left:-5px}
#fates .ft.urg .dl{color:#ff5a5a;font-weight:700}
#fates .ft.lost .zh{text-decoration:line-through;opacity:.7}
#fates .hint{margin:2px 0 4px 18px;font-size:11px;line-height:1.4;color:#a9a294;cursor:default}
#fates .hint[hidden]{display:none}
#mmwrap{position:absolute;left:10px;bottom:10px;padding:6px}
#minimap{display:block;width:128px;height:128px;border-radius:4px}
#bars{position:absolute;left:10px;bottom:152px;width:142px;padding:6px 8px;font-size:11px}
#bars .row{display:flex;align-items:center;gap:6px;margin:2px 0}
#bars .t{width:44px;height:8px;background:rgba(232,226,212,.15);border-radius:4px;overflow:hidden}
#bars .t i{display:block;height:100%;border-radius:4px}
#bars .hp i{background:#c0392b}#bars .mp i{background:#2980d9}
#hotbar{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px}
.slot{pointer-events:auto;cursor:pointer;width:64px;height:64px;padding:4px;text-align:center;position:relative;background:rgba(10,8,16,.72);border:1px solid rgba(232,226,212,.22);border-radius:6px;overflow:hidden}
.slot.sel{border-color:#c9a227;box-shadow:0 0 8px rgba(201,162,39,.6)}
.slot.empty{opacity:.35;cursor:default}
.slot.poor .ic{color:#5a5a5a}
.slot .key{position:absolute;top:2px;left:5px;font-size:10px;color:#c9a227}
.slot .ic{font-size:22px;line-height:1.2;display:block}
.slot .nm{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;color:#e8e2d4}
.slot .cost{position:absolute;bottom:2px;right:5px;font-size:10px;color:#7fb8ff}
.slot .cdov{position:absolute;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff}
.slot .cdov:empty{display:none}
`;

const KIND_GLYPH: Record<string, string> = { harm: '✦', help: '✚', self: '◈' };
const glyph = (s: HudSlot) => KIND_GLYPH[s.kind ?? ''] ?? '✧';
const short = (name: string) => name.length > 10 ? name.slice(0, 9) + '…' : name;

let root: HTMLElement | null = null;
let mm: HTMLCanvasElement | null = null;
/** Set by the 2D client: fires when the player presses 1-9 or clicks a slot. */
export let onCastSlot: ((i: number) => void) | null = null;

/** Build the overlay inside a positioned container (the game root div). */
export function mountHUD(container: HTMLElement): void {
  if (root) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.id = 'hud2d';
  root.innerHTML = `
    <div id="ww" class="panel"><div class="day">Day 1 / 7</div><div class="bar"><i style="width:14%"></i></div></div>
    <div id="fates" class="panel"><b>命运链</b><div class="ft">Phase 2 接入</div></div>
    <div id="bars" class="panel">
      <div class="row"><span>HP</span><div class="t hp"><i style="width:100%"></i></div></div>
      <div class="row"><span>MP</span><div class="t mp"><i style="width:100%"></i></div></div>
    </div>
    <div id="mmwrap" class="panel"><canvas id="minimap" width="128" height="128"></canvas></div>
    <div id="hotbar"></div>`;
  container.appendChild(root);
  mm = root.querySelector('#minimap');
  const hb = root.querySelector<HTMLElement>('#hotbar')!;
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('div');
    d.className = 'slot empty';
    d.innerHTML = `<span class="key">${i + 1}</span><span class="ic">·</span><span class="nm">—</span><span class="cost"></span><div class="cdov"></div>`;
    d.addEventListener('click', () => onCastSlot?.(i));
    hb.appendChild(d);
  }
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) onCastSlot?.(n - 1);
  });
}

// ------------------------------------------------------------------ update

function setBar(sel: string, frac: number): void {
  const el = root?.querySelector<HTMLElement>(`${sel} i`);
  if (el) el.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
}

function drawMinimap(s: HudSnapshot): void {
  const g = mm?.getContext('2d');
  if (!g || !root) return;
  const S = 128, half = s.worldHalf ?? WORLD_HALF, k = S / (half * 2);
  const P = (x: number, z: number): [number, number] => [(x + half) * k, (z + half) * k];
  g.clearRect(0, 0, S, S);
  g.fillStyle = 'rgba(16,14,24,.9)';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(201,162,39,.5)';
  g.strokeRect(0.5, 0.5, S - 1, S - 1);
  for (const c of s.creatures) {
    const [a, b] = P(c.x, c.z);
    g.fillStyle = c.hostile ? '#ff4d4d' : '#d9a05a';
    g.fillRect(a - 1.5, b - 1.5, 3, 3);
  }
  for (const w of s.wizards) {
    const [a, b] = P(w.x, w.z);
    const self = w.h === s.me.handle;
    g.fillStyle = self ? '#ffffff' : '#9a9a9a';
    g.beginPath();
    g.arc(a, b, self ? 3.5 : 2.5, 0, Math.PI * 2);
    g.fill();
  }
}

/** The single entry point: refresh every HUD element from one snapshot. */
export function updateHUD(s: HudSnapshot): void {
  if (!root) return;
  // top-center: war week countdown
  const day = Math.max(1, s.warweek?.day ?? 1), total = s.warweek?.total ?? 7;
  const ww = root.querySelector<HTMLElement>('#ww')!;
  ww.querySelector('.day')!.textContent = `Day ${day} / ${total}`;
  ww.querySelector<HTMLElement>('.bar i')!.style.width = `${(day / total) * 100}%`;
  ww.classList.toggle('final', day >= total);
  // hp / mana bars
  setBar('#bars .hp', s.me.hp / Math.max(1, s.me.maxHp));
  setBar('#bars .mp', s.me.mana / Math.max(1, s.me.maxMana));
  // minimap
  drawMinimap(s);
  // hotbar: 9 slots
  const hb = root.querySelector<HTMLElement>('#hotbar')!;
  for (let i = 0; i < 9; i++) {
    const slot = s.hotbar[i] ?? null;
    const el = hb.children[i] as HTMLElement;
    el.classList.toggle('sel', i === s.selected);
    el.classList.toggle('empty', !slot);
    el.classList.toggle('poor', !!slot && slot.mana != null && s.me.mana + 0.5 < slot.mana);
    (el.querySelector('.ic') as HTMLElement).textContent = slot ? glyph(slot) : '·';
    (el.querySelector('.nm') as HTMLElement).textContent = slot ? short(slot.name) : '—';
    (el.querySelector('.cost') as HTMLElement).textContent = slot?.mana != null ? String(slot.mana) : '';
    (el.querySelector('.cdov') as HTMLElement).textContent = slot && slot.cd >= 1 ? String(Math.ceil(slot.cd)) : '';
  }
  // fate chains: icon + name + deadline; click a row to expand the trigger hint.
  // Re-render only when the data (or the day) actually changed: snapshots arrive at 5Hz.
  renderFates(s);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let fateSig = '';
/** Render the fate-chain panel; no-op unless fates or the day changed. */
function renderFates(s: HudSnapshot): void {
  const day = Math.max(1, s.warweek?.day ?? 1);
  const list = s.fates ?? [];
  if (!list.length) return; // keep the mount placeholder until the server sends data
  const sig = day + '|' + list.map((x) => `${x.id}:${x.state}:${x.deadlineDay}`).join(',');
  if (sig === fateSig) return;
  fateSig = sig;
  const f = root?.querySelector<HTMLElement>('#fates');
  if (!f) return;
  f.innerHTML = '<b>命运链</b>' + list.map((x) => {
    const left = (x.deadlineDay ?? 7) - day + 1;
    const urg = x.state === 'open' && left <= 1 ? ' urg' : '';
    const icon = x.state === 'saved' ? '✓' : x.state === 'lost' ? '✗' : '…';
    const dl = x.state === 'open'
      ? `<span class="dl">${left <= 0 ? '今日截止' : `D${x.deadlineDay}截止`}</span>`
      : '';
    const hint = x.hint ? `<div class="hint" hidden>${escapeHtml(x.hint)}</div>` : '';
    return `<div class="ft ${x.state}${urg}"><span class="ic">${icon}</span> <span class="zh">${escapeHtml(x.zh)}</span> ${dl}${hint}</div>`;
  }).join('');
  f.querySelectorAll<HTMLElement>('.ft').forEach((el) => {
    el.addEventListener('click', () => {
      const h = el.querySelector<HTMLElement>('.hint');
      if (h) h.hidden = !h.hidden;
    });
  });
}

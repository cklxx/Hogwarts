/**
 * 观战 (docs/TODO.md P4): watching an agent play.
 *
 * - **Observe mode** (your own wizard, `V`): the camera still turns, but your keys and clicks no longer move or
 *   cast (they would take over from the agent: the human always comes first, formal/tla/Control.tla). 「接管」
 *   turns it off.
 * - **The agent panel**: the agent's goal and its recent MCP calls; your own spells' source (only yours).
 * - **Spectating** (`/#watch=<code>` from someone's watch link, or `/#follow=<handle>` from the leaderboard):
 *   no login, a read-only socket, the camera on that wizard.
 * - **Your watch link** (Owl Post menu): make, copy or revoke it; allow or refuse public watching.
 */
import { L } from './i18n';

export type Spectate = { watch: string } | { follow: string } | null;

/** `#watch=<code>` or `#follow=<handle>` in the address (the fragment never reaches a server log). */
export function spectateFromUrl(href: string): Spectate {
  const h = new URL(href).hash.replace(/^#/, '');
  const p = new URLSearchParams(h);
  const code = p.get('watch'), follow = p.get('follow');
  if (code && /^[\w-]{4,40}$/.test(code)) return { watch: code };
  if (follow && /^[\w-]{1,40}$/.test(follow)) return { follow };
  return null;
}

/** The query for /ws and /api/watch; a realm-prefixed code ("2-…") also names its realm for a front door. */
export function spectateQuery(s: NonNullable<Spectate>): string {
  if ('watch' in s) {
    const realm = /^(\d+)-/.exec(s.watch)?.[1];
    return `watch=${encodeURIComponent(s.watch)}${realm ? `&realm=${realm}` : ''}`;
  }
  return `follow=${encodeURIComponent(s.follow)}`;
}

/** Messages that move or act for your wizard: observe mode keeps them from taking over from the agent. */
const ACTING = new Set(['input', 'cast', 'goto', 'chest', 'dodge']);

export interface AgentCallView { tool: string; ok: boolean; spell?: string; source?: string; ago: number }
export interface AgentView { goal: string | null; paused: boolean; active: boolean; seen: { client: string; tool: string } | null; log: AgentCallView[] }
export interface WatchState { handle: string; name: string; house: string; year: number; hp: number; maxHp: number; mana: number; maxMana: number; online: boolean; agent: AgentView }

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const OBSERVE_KEY = 'hogwarts.observe';
/** Tool names a watcher reads more easily in Chinese (the rest show as they are). */
const TOOL_ZH: Record<string, string> = {
  cast: '施法', forge_spell: '铸造咒语', simulate_spell: '模拟咒语', move_to: '走路', look: '环顾四周', whoami: '看自己', grimoire: '翻课本',
  armory: '看咒语书', tell_player: '给你写信', listen: '等你的信', wait: '等待', set_goal_note: '写下目标', sit_exam: '考试', school_events: '看校园新闻',
  open_chest: '开宝箱', publish_spell: '上架咒语', market_browse: '逛集市', copy_spell: '抄咒语', fork_spell: '改编咒语', decree: '颁布法令', say: '说话',
};

export function createWatch(deps: { send: (o: unknown) => void; toast: (s: string) => void; copy: (text: string, btn?: HTMLElement) => void }) {
  let observing = false;
  try { observing = localStorage.getItem(OBSERVE_KEY) === '1'; } catch { /* private mode */ }
  let spectating: WatchState | null = null;
  let mine: AgentView | null = null;
  let link: { code: string | null; watchable: boolean } | null = null;
  let panelOpen = true;

  const panel = document.createElement('aside');
  panel.id = 'watchpanel';
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');
  document.body.appendChild(panel);
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.act === 'takeover') setObserving(false);
    if (b.dataset.act === 'fold') { panelOpen = !panelOpen; render(); }
  });

  function setObserving(on: boolean) {
    observing = on;
    try { localStorage.setItem(OBSERVE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
    if (on) deps.send({ t: 'input', dx: 0, dz: 0 }); // let go of the keys the agent would otherwise wait out
    deps.toast(on ? L('👁 观看模式：你的按键不会打断 Agent（镜头照样能转）。按 V 或点「接管」自己来。', '👁 Watching: your keys will not interrupt your agent (the camera still turns). V or "Take over" to play yourself.') : L('你接管了：Agent 会给你让路。', 'You took over: your agent gives way.'));
    render();
  }

  const ago = (s: number) => (s < 5 ? L('刚刚', 'just now') : s < 60 ? L(`${s} 秒前`, `${s}s ago`) : L(`${Math.floor(s / 60)} 分钟前`, `${Math.floor(s / 60)}m ago`));
  const callHtml = (c: AgentCallView) => `<li class="${c.ok ? '' : 'bad'}"><span class="wt">${esc(L(TOOL_ZH[c.tool] ?? c.tool, c.tool))}</span>${c.spell ? ` <b>${esc(c.spell)}</b>` : ''}${c.ok ? '' : ` <i>${L('失败', 'failed')}</i>`}<span class="wa">${ago(c.ago)}</span>${c.source ? `<pre>${esc(c.source)}</pre>` : ''}</li>`;

  function render() {
    const a = spectating?.agent ?? mine;
    panel.hidden = !(spectating || observing);
    document.body.classList.toggle('observing', observing && !spectating);
    if (panel.hidden) return;
    const who = spectating ? L(`正在观看 <b>${esc(spectating.name)}</b>`, `Watching <b>${esc(spectating.name)}</b>`) : L('👁 观看模式', '👁 Watching your agent');
    const state = !a ? L('Agent 还没来。', 'No agent yet.') : !a.active ? L('Agent 现在没在玩。', 'The agent is not playing right now.') : a.paused ? L('Agent 已暂停。', 'The agent is paused.') : L(`${esc(a.seen?.client ?? 'Agent')} 正在玩`, `${esc(a.seen?.client ?? 'The agent')} is playing`);
    const bars = spectating ? `<div class="wb"><span>${L('生命', 'HP')} ${spectating.hp}/${spectating.maxHp}</span> <span>${L('法力', 'Mana')} ${spectating.mana}/${spectating.maxMana}</span> <span>${L(`${spectating.year} 年级`, `Year ${spectating.year}`)}</span></div>` : '';
    const log = a?.log.length ? `<ol class="wl">${[...a.log].reverse().slice(0, panelOpen ? 8 : 3).map(callHtml).join('')}</ol>` : '';
    panel.innerHTML = `<header><span>${who}</span><button type="button" class="ghost quiet" data-act="fold" aria-expanded="${panelOpen}">${panelOpen ? '−' : '+'}</button></header>
      <p class="ws">${state}</p>${bars}
      ${a?.goal ? `<p class="wg">${L('目标', 'Goal')}：${esc(a.goal)}</p>` : ''}
      ${log}
      ${spectating ? `<p class="hint">${L('只能看，不能操作。', 'Watch only: nothing you press reaches the game.')}</p>` : `<p class="row"><button type="button" data-act="takeover">${L('接管（自己玩）', 'Take over')}</button> <span class="hint"><kbd>V</kbd></span></p>`}`;
  }

  return {
    /** Spectating someone (no login, read-only). */
    spectating: () => !!spectating,
    observing: () => observing,
    toggleObserving: () => setObserving(!observing),
    /** Drop what would move or act for your wizard while observing (everything, while spectating). */
    blocks(o: unknown): boolean {
      const t = (o as { t?: string })?.t ?? '';
      if (spectating) return true;
      if (!observing || !ACTING.has(t)) return false;
      const m = o as { dx?: number; dz?: number };
      return t !== 'input' || Math.hypot(m.dx ?? 0, m.dz ?? 0) > 0.01; // a zero input (letting go) is harmless
    },
    /** The watch messages; true when handled. `onWatching` gets the watched wizard's handle. */
    onMessage(msg: any, onWatching?: (handle: string) => void): boolean {
      if (msg.t === 'watching') { spectating = msg.s; onWatching?.(msg.s.handle); render(); return true; }
      if (msg.t === 'watch') { spectating = msg.s; render(); return true; }
      if (msg.t === 'agentlog') { mine = msg.s; render(); return true; }
      if (msg.t === 'watchlink') { link = { code: msg.code ?? null, watchable: !!msg.watchable }; renderLink(); return true; }
      return false;
    },
    /** The Owl Post menu's 观战 section (filled by renderLink once the server answers). */
    menuHtml: () => `<h3>👁 ${L('观战：让别人看你的 Agent 玩', 'Let others watch your agent play')}</h3><div id="op-watch"></div>`,
    bindMenu() { renderLink(); },
  };

  function renderLink() {
    const box = document.getElementById('op-watch');
    if (!box) return;
    const url = link?.code ? `${location.origin}/#watch=${link.code}` : '';
    box.innerHTML = `${url ? `<div class="op-cmd"><pre id="op-watch-url">${esc(url)}</pre><button class="ghost" data-act="copy">${L('复制', 'Copy')}</button></div>
        <p class="hint">${L('拿到链接的人只能看、不能操作，看不到你的咒语源码，也拿不到你的密钥。', 'Whoever has it can watch, never act, never see your spell source or key.')}</p>` : `<p class="hint">${L('生成一个观看链接发给朋友：他们打开就能看你（和你的 Agent）在玩什么。', 'Make a watch link for friends: opening it shows what you (and your agent) are up to.')}</p>`}
      <p class="row"><button data-act="new">${url ? L('换一个新链接（旧的失效）', 'New link (the old one stops)') : L('生成观看链接', 'Make a watch link')}</button>${url ? ` <button class="ghost" data-act="revoke">${L('撤销', 'Revoke')}</button>` : ''}</p>
      <p><label><input type="checkbox" id="op-watchable" ${link?.watchable === false ? '' : 'checked'}> ${L('允许别人在我的 Agent 玩的时候从排行榜观看我', 'Let others watch me from the leaderboard while my agent plays')}</label></p>`;
    box.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (b?.dataset.act === 'new') deps.send({ t: 'watchlink' });
      if (b?.dataset.act === 'revoke') deps.send({ t: 'watchrevoke' });
      if (b?.dataset.act === 'copy') deps.copy(url, b);
    };
    const cb = document.getElementById('op-watchable') as HTMLInputElement | null;
    if (cb) cb.onchange = () => deps.send({ t: 'watchable', on: cb.checked });
  }
}

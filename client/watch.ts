/**
 * 看 Agent 玩: you watch your own wizard move while your agent plays it.
 *
 * - **Observe mode** (`V`): the camera still turns, but your keys and clicks no longer move or cast (they would take
 *   over from the agent: the human always comes first, formal/tla/Control.tla). 「接管」 turns it off.
 * - **The agent panel**: the agent's goal and its recent MCP calls, with the source of the spells it cast.
 */
import { L } from './i18n';

/** Messages that move or act for your wizard: observe mode keeps them from taking over from the agent. */
const ACTING = new Set(['input', 'cast', 'goto', 'chest', 'dodge', 'duel', 'quidditch']);

export interface AgentCallView { tool: string; ok: boolean; spell?: string; source?: string; ago: number }
export interface AgentView { goal: string | null; paused: boolean; active: boolean; seen: { client: string; tool: string } | null; log: AgentCallView[] }

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const OBSERVE_KEY = 'hogwarts.observe';
/** Tool names read more easily in Chinese (the rest show as they are). */
const TOOL_ZH: Record<string, string> = {
  cast: '施法', forge_spell: '铸造咒语', simulate_spell: '模拟咒语', move_to: '走路', look: '环顾四周', whoami: '看自己', grimoire: '翻课本',
  armory: '看咒语书', tell_player: '给你写信', listen: '等你的信', wait: '等待', set_goal_note: '写下目标', sit_exam: '考试', school_events: '看校园新闻',
  open_chest: '开宝箱', publish_spell: '上架咒语', market_browse: '逛集市', copy_spell: '抄咒语', fork_spell: '改编咒语', decree: '颁布法令', say: '说话',
};

export function createWatch(deps: { send: (o: unknown) => void; toast: (s: string) => void }) {
  let observing = false;
  try { observing = localStorage.getItem(OBSERVE_KEY) === '1'; } catch { /* private mode */ }
  let mine: AgentView | null = null;
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
    const a = mine;
    panel.hidden = !observing;
    document.body.classList.toggle('observing', observing);
    if (panel.hidden) return;
    const state = !a ? L('Agent 还没来。', 'No agent yet.') : !a.active ? L('Agent 现在没在玩。', 'The agent is not playing right now.') : a.paused ? L('Agent 已暂停。', 'The agent is paused.') : L(`${esc(a.seen?.client ?? 'Agent')} 正在玩`, `${esc(a.seen?.client ?? 'The agent')} is playing`);
    const log = a?.log.length ? `<ol class="wl">${[...a.log].reverse().slice(0, panelOpen ? 8 : 3).map(callHtml).join('')}</ol>` : '';
    panel.innerHTML = `<header><span>${L('👁 观看模式', '👁 Watching your agent')}</span><button type="button" class="ghost quiet" data-act="fold" aria-expanded="${panelOpen}">${panelOpen ? '−' : '+'}</button></header>
      <p class="ws">${state}</p>
      ${a?.goal ? `<p class="wg">${L('目标', 'Goal')}：${esc(a.goal)}</p>` : ''}
      ${log}
      <p class="row"><button type="button" data-act="takeover">${L('接管（自己玩）', 'Take over')}</button> <span class="hint"><kbd>V</kbd></span></p>`;
  }

  return {
    observing: () => observing,
    toggleObserving: () => setObserving(!observing),
    /** Drop what would move or act for your wizard while observing (a zero input, letting go, is harmless). */
    blocks(o: unknown): boolean {
      const t = (o as { t?: string })?.t ?? '';
      if (!observing || !ACTING.has(t)) return false;
      const m = o as { dx?: number; dz?: number };
      return t !== 'input' || Math.hypot(m.dx ?? 0, m.dz ?? 0) > 0.01;
    },
    /** The agent's activity (server: once a second while it plays); true when handled. */
    onMessage(msg: { t: string; s?: unknown }): boolean {
      if (msg.t !== 'agentlog') return false;
      mine = msg.s as AgentView;
      render();
      return true;
    },
  };
}

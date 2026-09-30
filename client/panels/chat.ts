/**
 * 聊天 in the browser (src/kernel/chat.ts): a folded log in the lower left with four tabs — all, house, near and
 * whispers — fed by the 'chat' events the server lets you see. Typing goes through the chat box as before (Enter):
 * `/h …` house, `/n …` near, `/w name …` a whisper (client/controls.ts routeChat). A name in the log is a button that
 * starts a whisper to them. The log keeps CHAT_KEEP lines; unread lines on a hidden tab show as a count.
 */
import type { ClientFeature, ClientFeatureFactory } from '../feature';
import { L, lang } from '../i18n';
import { esc } from './logic';
import './chat.css';

export type ChatTab = 'all' | 'house' | 'near' | 'dm';
export interface ChatEv { id: number; type: string; text: string; zh?: string; ch?: ChatTab }
export const CHAT_KEEP = 80;
const TABS: readonly [ChatTab, string, string][] = [['all', '全部', 'All'], ['house', '学院', 'House'], ['near', '附近', 'Near'], ['dm', '悄悄话', 'Whispers']];
const PREFIX: Record<ChatTab, string> = { all: '', house: '/h ', near: '/n ', dm: '/w ' };

/** The rows a tab shows (the "all" tab shows every channel); pure, for tests. */
export function chatRows(lines: readonly ChatEv[], tab: ChatTab, zh: boolean) {
  return lines.filter((l) => tab === 'all' || (l.ch ?? 'all') === tab).map((l) => {
    const text = zh && l.zh ? l.zh : l.text;
    // "[label] Name: words" / "Name: words" (the kernel's formats): the name becomes a button
    const m = /^(\[[^\]]*\]\s)?([^:：]{1,40})[:：]\s?([\s\S]*)$/.exec(text);
    return { id: l.id, ch: l.ch ?? 'all', label: m?.[1]?.trim() ?? '', name: m?.[2] ?? '', words: m ? m[3] : text };
  });
}

export const chatFeature: ClientFeatureFactory = (): ClientFeature => {
  const lines: ChatEv[] = [];
  const unread: Record<ChatTab, number> = { all: 0, house: 0, near: 0, dm: 0 };
  let tab: ChatTab = 'all', open = false, dirty = true;
  const el = document.createElement('div');
  el.id = 'chatlog';
  el.innerHTML = `<div class="cl-tabs" role="tablist">${TABS.map(([k, zh, en]) => `<button data-tab="${k}" role="tab">${L(zh, en)}<i></i></button>`).join('')}<button class="cl-fold" title="${L('收起 / 展开', 'Fold / unfold')}">▾</button></div><div class="cl-body" aria-live="polite"></div>`;
  document.body.append(el);
  const body = el.querySelector('.cl-body') as HTMLElement;
  const box = () => document.getElementById('chat') as HTMLInputElement | null;
  const start = (prefill: string) => { const b = box(); if (!b) return; b.hidden = false; b.value = prefill; b.focus(); b.setSelectionRange(prefill.length, prefill.length); };
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tb = t.closest('[data-tab]') as HTMLElement | null;
    if (tb) { const k = tb.dataset.tab as ChatTab; if (open && tab === k) start(PREFIX[k]); tab = k; open = true; unread[k] = 0; dirty = true; return; }
    if (t.closest('.cl-fold')) { open = !open; dirty = true; return; }
    const who = t.closest('[data-who]') as HTMLElement | null;
    if (who) start(`/w ${who.dataset.who} `);
  });
  function render() {
    dirty = false;
    el.classList.toggle('open', open);
    for (const b of Array.from(el.querySelectorAll<HTMLElement>('[data-tab]'))) {
      const k = b.dataset.tab as ChatTab;
      b.classList.toggle('on', open && k === tab);
      (b.querySelector('i') as HTMLElement).textContent = unread[k] && !(open && k === tab) ? String(Math.min(99, unread[k])) : '';
    }
    if (!open) return;
    body.innerHTML = chatRows(lines, tab, lang === 'zh').slice(-40).map((r) =>
      `<p class="ch-${r.ch}">${r.label ? `<span class="cl-l">${esc(r.label)}</span> ` : ''}${r.name ? `<button class="cl-n" data-who="${esc(r.name)}">${esc(r.name)}</button>：` : ''}${esc(r.words)}</p>`).join('')
      || `<p class="cl-empty">${L('还没有人说话。按 Enter 说一句；/h 学院、/n 附近、/w 名字 悄悄话。', 'Nobody has spoken yet. Enter to speak; /h house, /n near, /w name to whisper.')}</p>`;
    body.scrollTop = body.scrollHeight;
  }
  return {
    id: 'chat',
    widgets: [{ id: 'chatlog', zh: '聊天记录', en: 'Chat log' }],
    onEvent(e) {
      const ev = e as ChatEv;
      if (ev.type !== 'chat' || lines.some((l) => l.id === ev.id)) return;
      lines.push(ev);
      if (lines.length > CHAT_KEEP) lines.splice(0, lines.length - CHAT_KEEP);
      const ch = ev.ch ?? 'all';
      if (!(open && (tab === 'all' || tab === ch))) { unread[ch]++; if (ch !== 'all') unread.all++; }
      dirty = true;
    },
    hud() { if (dirty) render(); },
  };
};

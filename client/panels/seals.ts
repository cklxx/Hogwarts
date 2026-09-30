/**
 * 禁书区 in the browser (src/kernel/seals.ts SEALS_FEATURE): R opens the Restricted Section (index.html #seals) — the
 * four seals, where their pages rest, the runes you hold and the codex; F at a landmark reads the page resting there.
 * Everything goes through {t:'seals', op?: 'read' | 'break', tier, words} and comes back as {t:'seals', r}.
 */
import { LANDMARKS } from '../../src/shared/map';
import type { ClientFeatureFactory } from '../feature';
import { L, lang, placeName } from '../i18n';
import { ic } from '../ink';
import { heightAt } from '../terrain';
import { esc } from './logic';

interface SealInfo { tier: number; name: string; zh: string; rewardZh: string; requiresYear: number; inputWords: number; reward: string; state: string; pages: { page: number; where: string; collected: boolean }[] }
interface Section { progress: string; seals: SealInfo[]; codex: string[] }
interface Current { tier: number; name: string; zh: string; inputWords: number; pagesCollected: string; runes: string; broken: boolean }
interface Reply {
  section: Section; current: Current;
  read?: { tier: number; page: number; of: number };
  broke?: { opened: boolean; reward?: string; message?: string };
}

const sealState = (st: string) => lang !== 'zh' ? st : st === 'broken' ? '已破解' : st === 'open to you' ? '向你敞开' : st.startsWith('needs year') ? `需要 ${st.slice(-1)} 年级` : '先破解上一道封印';

export const sealsFeature: ClientFeatureFactory = (d) => {
  const $ = (id: string) => document.getElementById(id)!;
  let seals: SealInfo[] | null = null;
  let tier = 1, asked = -1, lastRead = -1e9;
  const me = () => d.me() as { seals: number; year: number; stunned?: number } | null;
  function render(r: Reply) {
    const { section, current } = r;
    tier = current.tier;
    $('seal-list').innerHTML = section.seals.map((x) => `<div class="${x.state === 'broken' ? 'broken' : ''}">${ic(x.state === 'broken' ? 'seal-broken' : 'seal')}<b>${esc(L(x.zh, x.name))}</b><br/>${esc(sealState(x.state))} · ${L(`${x.requiresYear} 年级`, `year ${x.requiresYear}`)} · ${L(`${x.inputWords} 个字`, `${x.inputWords} word(s)`)}<br/><i>${esc(L(x.rewardZh, x.reward))}</i><br/>${x.pages.map((p) => `<span class="pg${p.collected ? '' : ' no'}">${ic('scroll')} ${esc(placeName(p.where))}</span>`).join('<br/>')}</div>`).join('');
    $('seal-title').textContent = L(`${current.zh} —— 已收集 ${current.pagesCollected} 页${current.broken ? '（已破解）' : ''}`, `${current.name} — ${current.pagesCollected} pages${current.broken ? ' (broken)' : ''}`);
    $('seal-runes').textContent = current.runes;
    $('seal-codex').textContent = section.codex.join('\n');
  }
  const read = (t: number) => { lastRead = performance.now(); d.send({ t: 'seals', op: 'read', tier: t }); };
  function toggle(force?: boolean) {
    const s = $('seals');
    s.hidden = !(force ?? s.hidden);
    if (!s.hidden) { d.solo(s); d.send({ t: 'seals' }); }
  }
  $('seal-read').onclick = () => read(tier);
  $('seal-break').onclick = () => d.send({ t: 'seals', op: 'break', tier, words: ($('seal-words') as HTMLInputElement).value.split(/[\s,]+/).filter(Boolean) });
  return {
    id: 'seals',
    // the section again whenever you break a seal (and once at the start): the F prompt needs to know where the pages rest
    hud() { const m = me(); if (m && asked !== m.seals) { asked = m.seals; d.send({ t: 'seals' }); } },
    keydown(e) {
      if (e.key !== 'r' && e.key !== 'R') return false;
      toggle();
      return true;
    },
    onMessage(msg) {
      if (msg.t !== 'seals') return false;
      const r = msg.r as Reply;
      seals = r.section.seals;
      if (r.read) d.toast(L(`📜 第 ${r.read.tier} 道封印的第 ${r.read.page}/${r.read.of} 页已抄进你的笔记。`, `📜 Page ${r.read.page}/${r.read.of} of seal ${r.read.tier} copied into your notes.`));
      if (r.broke) d.toast(r.broke.opened ? L('📕 封印打开了！', `📕 The seal opens! ${r.broke.reward}`) : `✗ ${L('ALGIZ 没有出现。封印纹丝不动，还反咬了你一口（-15 生命）。', r.broke.message ?? '')}`);
      render(r);
      return true;
    },
    // a page read that failed means our copy of the Restricted Section is stale (an agent may have read it over MCP)
    onError() { if (performance.now() - lastRead < 3000) asked = -1; return false; },
    close() { const s = $('seals'); if (s.hidden) return false; s.hidden = true; return true; },
    open(what) { if (what !== 'seals') return false; if ($('seals').hidden) toggle(true); return true; },
    /** F at a landmark where a page of the seal you can break next rests. */
    action() {
      const m = me(), p = d.myPos();
      if (!m || !p || !seals) return null;
      for (const s of seals) {
        if (s.tier <= m.seals) continue;
        // a seal below its year will not even speak to you: no prompt at the spawn for a first-year
        if (m.year < (s.requiresYear ?? 1)) continue;
        for (const pg of s.pages) {
          if (pg.collected) continue;
          const l = LANDMARKS.find((x) => x.name === pg.where);
          if (!l || Math.hypot(l.x - p.x, l.z - p.z) > 9.5) continue;
          return {
            label: L(`按 F 阅读书页 ·「${esc(s.zh)}」第 ${pg.page} 页`, `F — read the page (${esc(s.name.split('—')[0].trim())}, page ${pg.page})`),
            x: l.x, z: l.z, y: heightAt(l.x, l.z) + 3.8,
            act: () => read(s.tier),
          };
        }
      }
      return null;
    },
  };
};

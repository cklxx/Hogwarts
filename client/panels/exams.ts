import { OWL_ACHIEVEMENTS } from '../../src/lore/exams';
import { L, lang } from '../i18n';
import { ic } from '../ink';
import { PASSING, TROLL_MEME, esc, gradeName, pickLang } from './logic';
import type { BoardRow, ExamBoard, ExamInfo, ExamList, Grade, SitReport } from './types';

/**
 * 普通巫师等级考试 (key K, the spellbook's O.W.L. ribbon, the 下一步 line): this week's exams on the left (subject,
 * title, your best grade), the chosen one on the right — brief, par, reward, a Runes editor like the spellbook's
 * (load any spell of yours into it), 交卷 → a CI-style report with every hidden case, the grade (the Troll gets its
 * meme), rewards, achievements and your rank — and that exam's leaderboard.
 */
export interface ExamDeps {
  send: (o: unknown) => void;
  solo: (el: HTMLElement) => void;
  mark: () => void;
  spells: () => { id: string; name: string; builtin: boolean; source: string }[];
  /** Ask for the armory (the "load from your spellbook" menu reads it). */
  wantSpells: () => void;
}

/** "zh · en" (the kernel's case names) in the reader's language. */
const pick = (s: string) => { const i = s.indexOf(' · '); return i < 0 ? s : lang === 'zh' ? s.slice(0, i) : s.slice(i + 3); };
const line = (l: { zh: string; en: string }) => L(l.zh, l.en);
/** One language of a "中文 English" string. */
const bi = (s: string) => pickLang(s, lang);
const badge = (g: Grade, big = false) => `<span class="grade g-${g}${big ? ' big' : ''}${PASSING.has(g) ? ' pass' : ' fail'}" title="${esc(gradeName(g) + (g === 'T' ? ' — ' + TROLL_MEME() : ''))}">${g}</span>`;

export function createExams(d: ExamDeps) {
  const el = document.createElement('div');
  el.id = 'exams';
  el.className = 'sheet';
  el.hidden = true;
  document.getElementById('hud')!.append(el);
  let list: ExamList | null = null;
  let sel: string | null = null;
  const drafts = new Map<string, string>();
  const reports = new Map<string, SitReport>();
  const boards = new Map<string, BoardRow[]>();
  let msg = '';
  let sitting = false;
  let listAt = -1e9;

  const exam = (): ExamInfo | null => list?.exams.find((e) => e.id === sel) ?? null;
  function refresh() { if (performance.now() - listAt < 800) return; listAt = performance.now(); d.send({ t: 'exams' }); }
  function toggle(force?: boolean) {
    el.hidden = !(force ?? el.hidden);
    if (!el.hidden) { d.solo(el); refresh(); d.wantSpells(); render(true); }
  }

  function listHtml(): string {
    if (!list) return `<p class="hint">${L('考官正在分发考卷……', 'The examiners are handing out the papers…')}</p>`;
    return `<ul class="ex-list">${list.exams.map((e) => `<li data-ex="${esc(e.id)}" class="${e.id === sel ? 'sel' : ''}${e.locked ? ' locked' : ''}">
      <span class="ex-g">${e.yourBest ? badge(e.yourBest.grade) : `<span class="grade none">${e.locked ? ic('key') : '·'}</span>`}</span>
      <span class="ex-t"><b>${esc(line(e.title))}</b><small>${esc(line(e.subject))} · ${L(`${e.year} 年级`, `year ${e.year}`)}${e.locked ? L(' · 未解锁', ' · locked') : ''}</small></span></li>`).join('')}</ul>`;
  }

  function reportHtml(r: SitReport): string {
    const troll = r.grade === 'T';
    const cases = r.cases.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span class="ck">${c.ok ? '✓' : '✗'}</span><div><b>${L(`用例 ${c.case}`, `case ${c.case}`)} · ${esc(pick(c.name))}</b> <small>gas <span class="num">${c.gas}</span> · ${L('法力', 'mana')} <span class="num">${Math.round(c.mana * 10) / 10}</span></small>${c.why ? `<div class="why">${esc(bi(c.why))}</div>` : ''}</div></li>`).join('');
    const score = r.score.points !== null
      ? `<p class="ci-score">${L('分数', 'Score')} <b class="num">${r.score.points}</b> <small>${L(`（节点 ${r.score.nodes}/${r.par.nodes} · gas ${r.score.gas}/${r.par.gas} · 法力 ${Math.round(r.score.mana * 10) / 10}/${r.par.mana}；100 = 标准线，越低越好）`, `(nodes ${r.score.nodes}/${r.par.nodes} · gas ${r.score.gas}/${r.par.gas} · mana ${Math.round(r.score.mana * 10) / 10}/${r.par.mana}; 100 = par, lower is better)`)}</small></p>` : '';
    const rewards = r.rewards ? `<p class="ci-rew">${ic('coin')}${L(`奖励：经验 +${r.rewards.xp} · 加隆 +${r.rewards.galleons} · 声望 +${r.rewards.reputation}`, `Rewards: +${r.rewards.xp} XP · +${r.rewards.galleons} Galleons · +${r.rewards.reputation} reputation`)}</p>` : '';
    const ach = r.achievements.map((a) => { const x = OWL_ACHIEVEMENTS[a]; return x ? `<span class="ach">${ic('cup')}${esc(L(x.zh, x.name))}</span>` : ''; }).join('');
    return `<div class="ci ${r.verdict === 'PASS' ? 'pass' : 'fail'}">
      <div class="ci-head">${badge(r.grade, true)}<div><b>${r.verdict} ${esc(r.passed)} — ${esc(line(r.gradeName))}</b>${troll && !/地下教室|dungeon/i.test(r.meme ?? '') ? `<div class="meme troll">${esc(TROLL_MEME())}</div>` : ''}${r.meme ? `<div class="meme${troll ? ' troll' : ''}">${esc(bi(r.meme))}</div>` : ''}
        ${r.rank ? `<div class="hint">${L(`排行榜第 ${r.rank} 名`, `rank ${r.rank} on the board`)}${r.improved ? '' : L('（没有刷新你的最好成绩）', ' (not better than your best)')}</div>` : ''}</div></div>
      ${r.compileError ? `<pre class="ci-err">✗ ${esc(bi(r.compileError))}</pre>` : ''}
      ${cases ? `<ol class="ci-cases">${cases}</ol>` : ''}
      ${score}${r.hint ? `<p class="ci-hint">${ic('quill')}${esc(bi(r.hint))}</p>` : ''}${r.toReachO ? `<p class="hint">${esc(bi(r.toReachO))}</p>` : ''}
      ${rewards}${ach ? `<p class="ci-ach">${ach}</p>` : ''}
      <details><summary>${L('原始日志（CI）', 'Raw log (CI)')}</summary><pre>${esc(r.log)}</pre></details>
    </div>`;
  }

  function boardHtml(e: ExamInfo): string {
    const rows = boards.get(e.id) ?? e.top;
    if (!rows.length) return `<p class="hint">${L('还没有人及格。第一个就是你？', 'Nobody has passed yet. Be the first?')}</p>`;
    return `<table class="ex-board"><tr><th>#</th><th>${L('巫师', 'Wizard')}</th><th>${L('等级', 'Grade')}</th><th>${L('分数', 'Score')}</th><th>${L('节点', 'Nodes')}</th><th>gas</th><th>${L('法力', 'Mana')}</th></tr>
      ${rows.map((b) => `<tr class="${b.you ? 'you' : ''}"><td>${b.rank}</td><td>${esc(b.name)}</td><td>${badge(b.grade)}</td><td>${b.points}</td><td>${b.nodes}</td><td>${b.gas}</td><td>${Math.round(b.mana * 10) / 10}</td></tr>`).join('')}</table>`;
  }

  function pageHtml(): string {
    const e = exam();
    if (!e) return `<p class="hint">${L('在左边选一门考试。', 'Pick an exam on the left.')}</p>`;
    const r = reports.get(e.id);
    const spells = d.spells().filter((s) => s.source);
    const opts = spells.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.builtin ? L('（课本）', ' (curriculum)') : ''}</option>`).join('');
    const lim = e.limits ? ` · ${L('本题上限', 'limits')}${e.limits.nodes !== undefined ? L(` 节点 ≤ ${e.limits.nodes}`, ` nodes ≤ ${e.limits.nodes}`) : ''}${e.limits.gas !== undefined ? ` gas ≤ ${e.limits.gas}` : ''}` : '';
    return `<h3 class="ex-title">${esc(line(e.title))} <small>${esc(line(e.subject))} · ${L(`${e.year} 年级`, `year ${e.year}`)} · ${L(`${e.cases} 个隐藏用例`, `${e.cases} hidden cases`)}</small></h3>
      <p class="ex-brief">${esc(line(e.brief))}</p>
      <p class="ex-par">${L('标准线', 'Par')}: ${L('节点', 'nodes')} <b class="num">${e.par.nodes}</b> · gas <b class="num">${e.par.gas}</b> · ${L('法力', 'mana')} <b class="num">${e.par.mana}</b>${lim}</p>
      <p class="ex-rew hint">${L(`本周首次及格：经验 +${e.reward.xp} · 加隆 +${e.reward.galleons} · 声望 +${e.reward.reputation}（O ×1.5，E ×1.25）`, `First pass this week: +${e.reward.xp} XP · +${e.reward.galleons} Galleons · +${e.reward.reputation} reputation (O ×1.5, E ×1.25)`)}</p>
      ${e.yourBest ? `<p class="ex-best">${L('你的最好成绩', 'Your best')}: ${badge(e.yourBest.grade)} ${esc(line(e.yourBest.gradeName))}${e.yourBest.points !== null ? L(` · 分数 ${e.yourBest.points}`, ` · score ${e.yourBest.points}`) : ''} · ${esc(e.yourBest.passed)}</p>` : ''}
      ${e.locked ? `<p class="warn">${L(`这是 ${e.year} 年级的考试：升到 ${e.year} 年级再来。`, `A year-${e.year} exam: come back in year ${e.year}.`)}</p>` : `
      <div class="row ex-acts"><select class="ex-load" title="${esc(L('把咒语书里的一个咒语载入编辑器', 'Load a spell from your book into the editor'))}"><option value="">${L('从咒语书载入……', 'Load from your spellbook…')}</option>${opts}</select>
        <button type="button" class="ex-sit"${sitting ? ' disabled' : ''}>${ic('quill')}${sitting ? L('阅卷中……', 'Marking…') : L('交卷', 'Hand it in')}</button>
        <span class="hint">${L('考场是一次性的沙盒：真实世界不受影响，不花法力。', 'The exam room is a throwaway sandbox: the real world is untouched, no mana spent.')}</span></div>
      <textarea class="ex-src runes" spellcheck="false" maxlength="4000" placeholder="${esc(L('在这里写 Runes，例如 (say (len (enemies 15)))', 'Write Runes here, e.g. (say (len (enemies 15)))'))}"></textarea>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}`}
      <div class="ex-out">${r ? reportHtml(r) : ''}</div>
      <h3>${ic('cup')}${L('排行榜', 'Leaderboard')} <small>${L('每人一行，同分先到先得', 'one row each; ties go to the earlier')}</small></h3>
      ${boardHtml(e)}`;
  }

  let lastSig = '';
  function render(force = false) {
    if (el.hidden) return;
    const e = exam();
    const sig = JSON.stringify([list, sel, e && reports.get(e.id), e && boards.get(e.id), msg, sitting, d.spells().length]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    // keep what is being typed: the editor's text lives in `drafts`, put back after the redraw
    const src = el.querySelector<HTMLTextAreaElement>('.ex-src');
    if (src && sel) drafts.set(sel, src.value);
    // (the right page scrolls on a desktop, the two columns together on a phone)
    const keep = [el.querySelector<HTMLElement>('.ex-page')?.scrollTop ?? 0, el.querySelector<HTMLElement>('.ex-cols')?.scrollTop ?? 0];
    const p = list?.progress;
    el.innerHTML = `<h2>${ic('scroll')}<span>${L('普通巫师等级考试', 'O.W.L.s')} <small>${list ? L(`本周 ${esc(list.week)} · 通过 <b class="num">${p!.passed}</b>/${p!.of} · 优秀 <b class="num">${p!.outstanding}</b>/${p!.of}`, `week ${esc(list.week)} · passed <b class="num">${p!.passed}</b>/${p!.of} · Outstanding <b class="num">${p!.outstanding}</b>/${p!.of}`) : ''} · <kbd>K</kbd></small></span> <button class="x" data-close="exams" title="Esc"><svg class="ic"><use href="#i-x"/></svg></button></h2>
      <p class="ex-sub hint">${L('代码就是答卷：每道题是一个固定的沙盒场景和若干隐藏测试。全部通过才及格，越省节点、gas 和法力分越好。一周全部及格得「O.W.L. 全科通过」，全部 O 得「O.W.L. 全 O」。', 'Code is the answer sheet: each exam is a fixed sandbox with hidden tests. Pass them all; fewer nodes, gas and mana score better. Pass every exam of the week for "Passed Every O.W.L.", all O for "Outstanding in Everything".')}</p>
      <div class="ex-cols"><nav>${listHtml()}</nav><section class="ex-page">${pageHtml()}</section></div>
      ${list ? `<details class="ex-rules"><summary>${L('评分规则', 'How it is graded')}</summary><p>${esc(line(list.grading))}</p></details>` : ''}`;
    const ta = el.querySelector<HTMLTextAreaElement>('.ex-src');
    if (ta && sel) ta.value = drafts.get(sel) ?? '';
    // the page keeps its place across redraws; after 交卷 it scrolls to the report (the answer to the click)
    const page = el.querySelector<HTMLElement>('.ex-page'), cols = el.querySelector<HTMLElement>('.ex-cols'), out = el.querySelector<HTMLElement>('.ex-out');
    if (out?.firstElementChild && toReport) { out.scrollIntoView({ block: 'start' }); toReport = false; }
    else if (keepPlace) { if (page) page.scrollTop = keep[0]; if (cols) cols.scrollTop = keep[1]; }
    keepPlace = true;
  }
  let toReport = false, keepPlace = true;

  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const li = t.closest('[data-ex]') as HTMLElement | null;
    if (li) {
      const src = el.querySelector<HTMLTextAreaElement>('.ex-src');
      if (src && sel) drafts.set(sel, src.value);
      sel = li.dataset.ex!;
      msg = '';
      keepPlace = false;
      if (!boards.has(sel)) d.send({ t: 'examboard', id: sel });
      render(true);
      return;
    }
    const b = t.closest('.ex-sit') as HTMLButtonElement | null;
    if (b && !b.disabled && sel) {
      const src = el.querySelector<HTMLTextAreaElement>('.ex-src')?.value ?? '';
      drafts.set(sel, src);
      if (!src.trim()) { msg = L('答卷是空的：写一段 Runes 再交。', 'The answer sheet is empty: write some Runes first.'); render(true); return; }
      msg = '';
      sitting = true;
      d.mark();
      d.send({ t: 'sit', id: sel, source: src });
      render(true);
    }
  });
  el.addEventListener('change', (ev) => {
    const s = ev.target as HTMLSelectElement;
    if (!s.classList.contains('ex-load') || !s.value) return;
    const sp = d.spells().find((x) => x.id === s.value);
    const ta = el.querySelector<HTMLTextAreaElement>('.ex-src');
    if (sp && ta && sel) { ta.value = sp.source; drafts.set(sel, sp.source); }
    s.value = '';
  });

  return {
    el, toggle, render,
    open(id?: string) { if (id) sel = id; toggle(true); },
    onList(r: ExamList) {
      list = r;
      if (!sel || !r.exams.some((e) => e.id === sel)) sel = (r.exams.find((e) => !e.locked && !(e.yourBest && PASSING.has(e.yourBest.grade))) ?? r.exams[0])?.id ?? null;
      render();
    },
    onSat(r: SitReport) {
      sitting = false; reports.set(r.exam, r); boards.delete(r.exam); d.send({ t: 'examboard', id: r.exam }); listAt = -1e9; refresh();
      toReport = r.exam === sel;
      render(true);
    },
    onBoard(r: ExamBoard) { boards.set(r.id, r.top); render(); },
    onError(text: string) { if (!sitting && el.hidden) return false; sitting = false; msg = text; render(true); return !el.hidden; },
    /** This week's progress for the 下一步 line: passed, and how many you may sit (null before the list came). */
    progress(): { passed: number; of: number; open: number } | null {
      return list ? { passed: list.progress.passed, of: list.progress.of, open: list.exams.filter((e) => !e.locked).length } : null;
    },
    refresh,
  };
}

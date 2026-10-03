/**
 * The observer sheet's numbers (docs/PLAYTEST_METRICS.md), from what the server recorded (kernel/metrics.ts):
 *
 *   npx tsx scripts/playtest/report.ts [path/to/world.json]     (default: $HOGWARTS_DATA or data/world.json)
 *
 * Prints a Markdown table, one row a player, then the round's figures beside their targets. The server saves the
 * world every few seconds, so a report run while it is up is at most that far behind. Names and times only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EARLY_S, SYSTEMS, SYSTEM_ZH, type PlayerMetrics } from '../../src/kernel/metrics.js';

const path = process.argv[2] ?? process.env.HOGWARTS_DATA ?? join(process.cwd(), 'data/world.json');
const world = JSON.parse(readFileSync(path, 'utf8')) as { features?: { metrics?: Record<string, PlayerMetrics> } };
const rows = Object.values(world.features?.metrics ?? {}).sort((a, b) => a.t0 - b.t0);
if (!rows.length) { console.log(`No players recorded in ${path} yet.`); process.exit(0); }

const s = (v: number | undefined) => (v === undefined ? '—' : `${v}`);
const TUT_STEPS = 7;
console.log(`| 玩家 | 设备 | 移动 秒 | 施法 秒 | 打倒魔物 秒 | 引导 | 前 ${EARLY_S / 60} 分钟被打倒 | 碰过的系统 | 聊天 | 在线 分 | 来了几次 |`);
console.log('|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|');
for (const m of rows) {
  const sys = SYSTEMS.filter((k) => m.sys[k] !== undefined);
  console.log(`| ${m.name} | ${m.touch === undefined ? '?' : m.touch ? '手机' : '桌面'}${m.view === '25d' ? '·2.5D' : m.view === 'top' ? '·俯视' : ''}${m.fps ? ` · ${Math.round(1000 / Math.max(1, m.fps.p50))} fps（p95 ${Math.round(m.fps.p95)} ms，3D ${m.fps.scale}x ${m.fps.q}${m.fps.gpu ? `，${m.fps.gpu}` : ''}）` : ''} | ${s(m.move)} | ${s(m.cast)} | ${s(m.kill)} | ${m.tut ?? 1}/${TUT_STEPS} | ${m.kosEarly} | ${sys.length}/10 ${sys.map((k) => SYSTEM_ZH[k]).join('、')} | ${m.chats} | ${Math.round(m.online / 60)} | ${m.sessions} |`);
}

// the round against docs/PLAYTEST_METRICS.md's first targets
const n = rows.length;
const share = (f: (m: PlayerMetrics) => boolean) => `${Math.round((100 * rows.filter(f).length) / n)}%`;
const median = (xs: number[]) => { if (!xs.length) return '—'; const v = [...xs].sort((a, b) => a - b); return `${v[Math.floor((v.length - 1) / 2)]}`; };
const got = (k: 'move' | 'cast' | 'kill') => rows.map((m) => m[k]).filter((v): v is number => v !== undefined);
console.log(`\n${n} 位玩家`);
console.log(`| 指标 | 本轮 | 目标 |\n|---|---:|---:|`);
console.log(`| 移动（中位数，秒） | ${median(got('move'))}（${got('move').length}/${n} 人做到） | < 15 |`);
console.log(`| 施法（中位数，秒） | ${median(got('cast'))}（${got('cast').length}/${n} 人做到） | < 60 |`);
console.log(`| 打倒第一只魔物（中位数，秒） | ${median(got('kill'))}（${got('kill').length}/${n} 人做到） | < 180 |`);
console.log(`| 引导走完 6 步以上 | ${share((m) => (m.tut ?? 1) >= 6)} | ≥ 80% |`);
console.log(`| 前 ${EARLY_S / 60} 分钟被打倒不超过 1 次 | ${share((m) => m.kosEarly <= 1)} | 全部 |`);
console.log(`| 碰过的系统（平均，共 10 个） | ${(rows.reduce((a, m) => a + Object.keys(m.sys).length, 0) / n).toFixed(1)} | ≥ 5 |`);
console.log(`| 写或改过咒语 | ${share((m) => m.sys.spell !== undefined)} | ≥ 50% |`);
console.log(`| 聊天 ≥ 3 句 | ${share((m) => m.chats >= 3)} | 全部 |`);
console.log(`| 回来过（第二次上线） | ${share((m) => m.sessions >= 2)} | ≥ 40% |`);
// the view experiment: the two groups side by side
const groups = (['top', 'follow'] as const).map((v) => ({ v, ms: rows.filter((m) => (m.view ?? 'follow') === v) })).filter((g) => g.ms.length);
if (groups.length > 1) {
  console.log(`\n| 视角 | 人数 | 打倒第一只魔物（中位数，秒） | 碰过的系统（平均） | 在线（平均，分） |\n|---|---:|---:|---:|---:|`);
  for (const g of groups) {
    const k = g.ms.map((m) => m.kill).filter((v): v is number => v !== undefined);
    console.log(`| ${g.v === 'top' ? '俯视' : '跟随'} | ${g.ms.length} | ${median(k)}（${k.length}/${g.ms.length} 人做到） | ${(g.ms.reduce((a, m) => a + Object.keys(m.sys).length, 0) / g.ms.length).toFixed(1)} | ${(g.ms.reduce((a, m) => a + m.online, 0) / g.ms.length / 60).toFixed(1)} |`);
  }
}
console.log('\n卡在哪、原话、问卷和访谈要观察员记录（docs/PLAYTEST_METRICS.md 第 3–5 节）。');

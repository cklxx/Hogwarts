# PR #29 道具管线审阅与复测

2026-10-06。基线 `c2332a6`，候选 `a9ee76e`（原实现 `ac9e110` 加上当前 main）。PR 从已过时的 `wf/ice` 改投 `main`，与 main 的生产代码差异只有 `client/props3d.ts`。复测后撤回 24→48 米分桶，只保留 UV 删除；最终版沿用 main 的 24 米剔除粒度。

## 几何与状态等价

运行 [geometry.mts](geometry.mts)，原候选结果见 [geometry.json](geometry.json)，最终版见 [final-geometry.json](final-geometry.json)。实际创建两份客户端道具插件，检查全部 20 种 body、7 种 glow 和 ring 的非 UV 属性、索引和包围盒；逐件比较 361 件道具在初始、破坏、点亮、复原四种状态的实例矩阵。全部一致。body / wet / glow / ring 材质无纹理 map；发光顶点 shader 只用位置与实例矩阵，环境反射也不依赖 UV。悬浮文字的 Sprite 纹理未改。

| 指标 | 基线 | 原 PR（48 米） | 最终版（24 米） |
|---|---:|---:|---:|
| 唯一几何的属性及索引字节 | 192248 | 159408 | 159408 |
| body 桶 | 173 | 137 | 173 |
| body + glow + ring 桶 | 250 | 194 | 250 |
| 实例矩阵字节 | 32576 | 32576 | 32576 |

最终几何数组约少 17.1%，桶数与实例矩阵字节不变。原 PR 的总桶数虽少 22.4%，不同机位的实际提交开销仍有取舍；同一静止快照的 witness 完全一致，剔除变粗会多提交视野外的实例。庭院拆开阴影更新后的计数见下文；整体帧平均受阴影更新频率影响，不能据此声称 24% 退化。本次未证明分桶的整体收益，故仅保留 UV 优化。桶数是场景对象数，不是每帧实际 draw call；这些字节也不是整场景 GPU 显存。

复现（两份 checkout 已安装相同 lockfile 依赖）：

```bash
npx tsx docs/playtest-logs/2026-10-06/props-pipeline/geometry.mts /absolute/baseline /absolute/candidate /tmp/geometry.json
```

## 浏览器对照方法

Node 24.19.0、Chromium 151.0.7922.173、Linux，1280×720，SwiftShader **软件渲染**。生产构建、同一私有静止世界：1 位观察者、0 bot、0 NPC、81 个生物；服务器 tick 与输入固定，浏览器装饰随机种子固定。高／低画质各庭院 follow、城堡 castle、黑湖 lake、禁林 forest、俯瞰 overview，预热 2 秒、采样 5 秒；调用数含所有渲染 pass。截图时 UI 被隐藏，hover 标签等 overlay 保持原客户端行为。

复用仓库已有 [static-perf.ts](../../2026-10-03/perf/static-perf.ts) 和同目录 `freeze-world.mjs`，复制到一个临时目录。当前 Chromium 要将 launch 的 `'--use-gl=swiftshader'` 替换为 `'--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'`；其它采样代码不变。原始 `scripts/perf-client.ts` 的计时与计数接口仍是 `window.__perf`。两轮共用 `PERF_FIXTURE`，使用不同 `PERF_TMP` 与端口：

```bash
BENCH_ROOT=/absolute/baseline PERF_FIXTURE=/tmp/props-fixture PERF_TMP=/tmp/props-before \
PLAYWRIGHT_CORE=/absolute/playwright-core/index.mjs CHROMIUM=/usr/bin/chromium \
npx tsx /tmp/props-harness/static-perf.ts --port=8891 --q=high,low \
  --spots=follow,castle,lake,forest,overview --bots=0 --crowd=0 --npcs=0 \
  --warm=2 --secs=5 --label=before --out=/tmp/before.jsonl --shots=/tmp/shots --census
# 原 PR candidate 使用相同参数，只改 BENCH_ROOT、PERF_TMP、port=8892、label=after 和 out。
```

私有世界、身份文件、服务器日志不归档。公开记录只含计数、计时、场景 census 与截图。

## 检查

候选生产代码：`tsc --noEmit`、Vitest **91 文件／948 项**及 `vite build` 全通过；四种道具状态等价检查通过。生产代码不修改内核或形式化模型，PR 合入仍要求最终 head 的 CI check 与完整 TLA+／Lean formal 全绿。

## 原 PR 的实际绘制计数

见 [before.jsonl](before.jsonl) 与 [original-candidate.jsonl](original-candidate.jsonl)。两份 [快照 witness](before-witness.json) 与 [候选 witness](original-candidate-witness.json) 完全一致。调用、三角形均为采样帧平均值；不同 pass 与发光粒子会有少量变化。

| 画质／机位 | 帧数（前／候选） | 调用（前→48米） | 三角形（前→48米） |
|---|---:|---:|---:|
| high/follow | 3/3 | 145.7 → 181.3 | 262145 → 281365 |
| high/castle | 3/4 | 582.3 → 584.0 | 288615 → 300475 |
| high/lake | 2/3 | 186.0 → 188.7 | 226658 → 247987 |
| high/forest | 2/2 | 118.0 → 112.5 | 172373 → 175425 |
| high/overview | 1/1 | 887.0 → 845.0 | 329576 → 329576 |
| low/follow | 6/6 | 137.0 → 132.0 | 184330 → 186826 |
| low/castle | 4/4 | 523.5 → 506.0 | 216404 → 220566 |
| low/lake | 8/5 | 118.0 → 116.0 | 138201 → 142799 |
| low/forest | 6/5 | 100.0 → 89.2 | 147364 → 147822 |
| low/overview | 5/3 | 865.2 → 784.3 | 262329 → 251671 |

俯瞰等部分视角减少调用，日常庭院视角增加调用与三角形；不能以全场景桶数推导普遍性能提升。每个短窗口的阴影更新次数不相同，整体帧平均不能直接用于断言性能退化或改善，也不适合估计 CPU 帧时间或 FPS 改善。


## 分开阴影更新后的结论与最终版

采样少量帧时，阴影更新次数会严重影响平均数：基线庭院 3 帧更新阴影 1 次，原 PR 3 帧更新 2 次，最终版 4 帧更新 2 次。上表庭院调用均值 145.7→181.3→167.0 不能直接当作分桶的变化。`passes` 和 `callsUnique` 可区分有／无阴影更新的帧。

| 庭院 high 单帧 | 基线 24米 | 原 PR 48米 | 最终 UV 精简 24米 |
|---|---:|---:|---:|
| 不更新阴影：总调用 | 103 | 104 | 103 |
| 更新阴影：总调用 | 231 | 220 | 231 |
| 不更新阴影：三角形 | 245684 | 247388 | 245684 |
| 更新阴影：三角形 | 295066 | 298354 | 295066 |

48 米分桶的无阴影帧增加 1 次调用与约 0.7% 三角形，阴影帧减少 11 次调用但三角形约增 1.1%；城堡无阴影调用从约 542→527，也有收益。它是一项视角和硬件相关的取舍，现有证据没有证明整个渲染管线更快，最终恢复 24 米，只合入可独立证明等价的 UV 减量。

最终版复核 high/follow 与 high/castle，原始计数见 [final.jsonl](final.jsonl)，[最终 witness](final-witness.json) 与其它两份完全一致。庭院两类帧的调用、三角形集合与基线完全相同。城堡调用集合基线 542/543/662，最终 542/661；基线包含一次短暂的粒子／实体变化（多 1 次调用、140 三角形），不能把它当作 UV 收益。三轮客户端均未报告 shader 或页面错误。

| 画面 | 基线 | 最终版 |
|---|---|---|
| 庭院 | [before-high-follow.png](before-high-follow.png) | [final-high-follow.png](final-high-follow.png) |
| 城堡 | [before-high-castle.png](before-high-castle.png) | [final-high-castle.png](final-high-castle.png) |

最终版类型检查、[948 项测试](vitest.log)及[生产构建](build.log)全通过。截图观察与几何／实例矩阵对照未见道具外观和状态回退；不宣称真实 GPU 或手机 FPS 提升。

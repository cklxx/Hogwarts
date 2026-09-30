# 给在这个仓库里工作的 Agent

霍格沃茨：three.js 多人 3D 游戏，咒语就是代码（Runes），AI Agent 通过 MCP 入学来玩。界面中文优先。

先读：`docs/PLAN.md`（接下来做什么、按什么顺序、怎么做）→ `docs/TODO.md`（每项的验收标准和遗留问题）→ `docs/RULES.md`（不能被打破的规则）→ `README.md`（玩法与架构）。

## 目录

| 路径 | 内容 |
|---|---|
| `src/kernel/` | 权威世界（`world.ts`，20 Hz）、Runes 咒语虚拟机（`magic.ts`）、规则书（`rulebook.ts`，zod 模式 = 宪法，法令只能改它）、生物、NPC、学院杯；**功能插件**（`feature.ts` 接口、`features.ts` 注册表）：黑魔王、邓布利多军、偷师、无规则区（`unfair.ts`）、禁书区封印（`seals.ts`）、聊天频道、集市、考试、事件轮盘、决斗俱乐部、魁地奇、触发式铁甲咒、飞路网与扫帚、今日课表 |
| `src/mcp/` | MCP 服务器（`server.ts`，每个会话一个）、Grimoire、stdio 桥 |
| `src/server/` | HTTP/WS/MCP 入口（`main.ts`）、局域网发现、多进程 REALMS、静态文件、使魔 |
| `client/` | 浏览器客户端（three.js `WebGLRenderer`，羊皮纸界面，`client/panels/*`） |
| `formal/` | TLA+ 规格与 Lean 证明；`test/formal.test.ts` 用对照向量把它们和内核绑在一起 |
| `desktop/` | Tauri 2 桌面微客户端（Rust），含 `--mcp-stdio` 桥 |
| `scripts/` | 压测、截图、视角审计、宣传视频、试玩客户端（`scripts/playtest/mcp.ts`） |
| `docs/` | PLAN、TODO、PERF、PLAYTEST、AGENT_LINK 等 |

## 规矩

- **提交前必须全绿**：`npx tsc --noEmit && npx vitest run && npx vite build`。改了 `desktop/` 再跑 `cargo test --manifest-path desktop/src-tauri/Cargo.toml`。
- **宪法**：`docs/RULES.md` 列出不能被打破的规则（密钥、公平、奖励上限、政治、Agent），每条都有代码位置和证明 / 测试。新功能不得违反；要加一条新的「不能破」，就写进去并配上证明或测试。
- **新玩法写成插件**：内核一个 `Feature`（`src/kernel/feature.ts`）加进 `features.ts`，客户端一个 `ClientFeature` 加进 `client/features.ts`；不要在 `world.ts` / `mcp/server.ts` / `server/main.ts` / `client/main.ts` 里点名新玩法。状态用声明合并挂到 `World` 上，存档走 `save` / `load`。插件还可以带 Runes 原语（`spells`：名字先登记进 `src/shared/constants.ts` 的 `PLUGIN_PRIMITIVES`，规则书才能给它定价、禁用）。
- **客户端插件能热更新**（`client/context.ts`、`client/hot.ts`，思路来自 cordis）：`ClientFeature` 的工厂拿到 `ctx`，留在页面上的东西都经过它——自己放进页面的元素 `ctx.own(el)`、挂在 `document`/`window`/页面固有元素上的监听 `ctx.on(...)`、定时器 `ctx.timeout/interval`、其余 `ctx.effect(() => undo)`。这样卸载时能撤干净，新构建只改了插件时浏览器原地换掉它，不刷新页面。新插件在 `client/features.ts` 里登记模块名，并同步 `import.meta.hot.accept` 的列表（`test/hot.test.ts` 会查）。
- **改内核规则或常量**：同步更新 `formal/`（TLA+ 规格、Lean、`formal/vectors.json` / `test/formal.test.ts`），并跑 `formal/run.sh`。
- **界面文字**用 `L('中文', 'English')`，中文在前；服务器事件带 `zh`。
- **性能改动**先测后改，前后数字写进 `docs/PERF.md`（软件渲染的帧率只看方向，要写明）。
- **密钥**（Owl Post key）永远不打印、不进日志、不进 URL 查询串（只放 `#k=` 片段或 Authorization 头）；`data/` 不提交。
- **素材**只用 CC0 / OFL 等干净许可证，来源写进对应的 CREDITS；配乐原创，不模仿《哈利·波特》电影配乐。
- **分支**：小改直接在 `main`；大功能开 `wf/<名字>`，做完 `git merge --no-ff` 回 `main` 并推送。
- **每次合入**更新 `docs/TODO.md`（完成的移到「已完成」并写提交号）；顺序变化同步 `docs/PLAN.md`。
- 提交信息写清楚做了什么、为什么、怎么验证的。

## 测试小贴士

- e2e 测试会自己起服务器（`HOST=127.0.0.1`，各用不同端口）。手动起的测试服务器用完要关：`pgrep -f 'node --import tsx src/server/main.ts' | xargs kill`。
- 截图 / 视角审计 / 客户端压测脚本需要 Chromium 和 playwright-core：`npm i --no-save playwright-core && npx playwright install chromium`，然后给脚本传 `--chromium=<路径>` 和 `--playwright=<playwright-core/index.mjs 路径>`（或设 `PLAYWRIGHT_CORE`）。
- 用 Agent 试玩：`npx tsx scripts/playtest/mcp.ts --url http://localhost:7777/mcp --me ./me.key enroll '{"name":"…"}'`，之后每条命令都用同一个 `--me` 文件。

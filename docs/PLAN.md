# 接下来的计划（交接给本地开发）

> 写于 2026-09-29。新电脑从零开始（克隆、git 用户、推送权限、给本地 Agent 的提示词）见 `docs/HANDOFF.md`。所有代码都在 `main` 上，没有未合并的分支。条目细节与验收标准以 `docs/TODO.md` 为准；这里是顺序、做法和本地环境。

## 现在的状态（一段话）

内核（20 Hz 权威世界、Runes 咒语、规则书与法令）、MCP（54 个工具）、浏览器客户端（WebGL，绘本画风，羊皮纸界面）、学院杯与校园事件、O.W.L. 考试、咒语集市、不公平机制、内置使魔、形式化验证（16 个 TLA+ 规格 + Lean）都在 `main`。刚完成：渲染器退回经典 WebGL（比 WebGPU 渲染器的回退快一倍左右）、生物会还手、服务器版本接口 + 局域网发现 + 「游戏已更新」提示、Tauri 桌面微客户端（`desktop/`，含一键连接 Agent 的 `--mcp-stdio` 桥）。

## 本地环境

```bash
# Node 22；仓库根目录
npm ci
npm run dev              # 服务器 + Vite 客户端（热更新）
npm start                # 只跑服务器（先 npx vite build）
npx tsc --noEmit && npx vitest run && npx vite build   # 提交前必跑，CI 也跑这三样
formal/run.sh            # 改了内核规则或常量时（需要 Java 21 + Lean，见 .github/workflows/ci.yml）
npm run find             # 列出局域网里的服务器
```

桌面客户端（`desktop/`，Tauri 2 + Rust）：

```bash
cd desktop && npm ci
npx tauri dev                                        # 调试运行
cargo test --manifest-path src-tauri/Cargo.toml      # 单元测试
npx tauri build                                      # 打当前平台的安装包
```

- macOS：Xcode 命令行工具即可。Windows：自带 WebView2（Win10/11），需要 Rust + VS Build Tools。Linux：`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`。
- CI（`.github/workflows/desktop.yml`）会为三个平台出安装包，放在该次运行的 Artifacts 里（未签名）。
- Linux 端到端测试：`dbus-run-session -- bash desktop/test-gui.sh /tmp/hw-gui`；桥的测试：见 `desktop/test-bridge.mts` 顶部注释。

提交约定：直接在 `main` 上做小改动；大功能开 `wf/<名字>` 分支，做完合回 `main`。每次合入顺手更新 `docs/TODO.md`（完成的移到「已完成」并写提交号）。

## 顺序（我的建议）

| # | 做什么 | 为什么排这里 | 估时 |
|---|---|---|---|
| 1 | **在你自己的 Mac / Windows 上验收桌面客户端** | P1/P2 只在 Linux 上实测过；这是唯一需要真机的一步 | 30 分钟 |
| ~~2~~ | ~~**P4 看 Agent 玩（观战）**~~ 已完成（见 TODO P4） | | |
| ~~3~~ | ~~**试玩遗留：经验平衡 + NPC 垫人**~~ 已完成（见 TODO 2a、PLAYTEST.md 平衡模拟） | | |
| 4 | **决斗手感 + 决斗俱乐部** | 好玩路线图第 3 步 | 3–4 天 |
| 5 | **第 2 轮 AI 试玩**（5 个角色，3 个学期） | 验证 2–4 的效果，数据写进 `docs/PLAYTEST.md` | 1 天 |
| 6 | **魁地奇** | 路线图第 4 步，工作量最大 | 1–2 周 |
| 7 | **宣传视频 v2** | 等 2、4 做完再拍，素材最好 | 1–2 天 |

### 1. 桌面客户端真机验收

1. 从最近一次「Desktop client」运行的 Artifacts 下载安装包（或本地 `npx tauri build`）。macOS 第一次右键 →「打开」；Windows「更多信息 → 仍要运行」。
2. 服务器用默认 `HOST=0.0.0.0` 启动，防火墙放行 TCP+UDP 7777。
3. 逐条验：启动器自动列出服务器 → 进入 → 游戏里登录一次 → 退出重开应直接进世界（钥匙串）→ 服务器换版本重启，壳内出现「游戏已更新」→ F11 全屏、Ctrl+Shift+S 回列表 → 启动器点「写入 Claude Desktop」，重启 Claude Desktop 后对它说「连上霍格沃茨」，`whoami` 应该是你的巫师。
4. 有问题记进 TODO 的 P1/P2 行。已知没做：安装包签名、壳本身的自动更新（Tauri updater）、Rust 桥没有 Node 桥的「猫头鹰推送」（`notifications/claude/channel`），`listen` 工具照常能用。

### 2. P4 看 Agent 玩

做法（涉及文件）：

- **观看模式不抢控制**：现在人一按 WASD，内核就让 Agent 的寻路让路（「人永远优先」，`src/kernel/world.ts` 的 `setInput` / Agent 暂停逻辑，客户端 `client/controls.ts`）。加一个客户端开关「观看」：开启时键盘和点击只转镜头，不发 `input`；HUD 上一个「接管」按钮关掉它。刷新后记住（`localStorage`）。
- **同屏显示 Agent 在做什么**：服务器已经记录 Agent 的最近动作和目标（HUD 左上的 Agent 状态，`set_goal_note`）。扩展成一个可折叠的侧栏：当前目标、最近 10 个工具调用（名称 + 一句结果）、最近铸造/施放的咒语源码（高亮）。数据从现有的 WebSocket 事件里来；只给巫师本人和观看者看。
- **看别人的 Agent**：新增 WebSocket 连接方式 `/ws?watch=<观看码>`：只读，服务器不接受它的任何 `input`/`cast`，快照以被观看的巫师为中心（复用 AOI）。排行榜和身边的人加「观看」按钮（需要对方允许，默认只允许看 Agent 在玩的时候）。
- **分享观看链接**：巫师本人生成观看码（与配对码同一套：随机、可撤销、不含密钥；`src/kernel/identity.ts`），链接形如 `http://<ip>:7777/#watch=<码>`。撤销后已连的观看者立即断开。
- **测试**：e2e 里一个 Agent 用 MCP 连续做事，另一个 WebSocket 以观看码连上，断言：收得到快照和动作事件、发 `input` 被拒、撤销后被踢；Agent 的寻路在观看者乱按时不中断。

### 3. 试玩遗留

- **经验平衡**：现在 5 门考试约 90 经验，打 10 发怪 55 经验。生物会还手以后，刷怪有了风险，按「风险 × 用时」重定每种生物的经验（`src/kernel/creatures.ts` 的 `xp`/`rep`），考试经验每门每周只给第一次（大概已经如此，确认）。用第 2 轮试玩的数据验证：刷怪与考试每分钟经验在 0.7–1.3 倍之间。
- **NPC 垫人**（`src/kernel/npc.ts`）：NPC 每学期上架 1–2 个课本变体咒语到集市（带标记，不拿版税）、参加部长竞选（没人竞选时才出马）、接受决斗邀请。目标：一个真人进服也能看到排行榜在动、集市有货、部长不是空的。
- **digest 上集市返回空字段**：先确认那台机器跑的版本（`/api/version`），本地 `main` 复现不了。

### 4. 决斗手感 + 决斗俱乐部

照 TODO 第 3 步：施法前摇 / 受击硬直 / 命中停顿与屏幕震动（尊重「减少动态效果」）、咒语对撞抵消、翻滚闪避、盔甲护身弹反的时机；礼堂决斗台（报名、1v1/2v2 排队、鞠躬、倒计时、观众席、赛后摘要）；决斗学院分有界（同一对手冷却、每学期上限），补 Lean 证明和 `test/formal.test.ts` 的对照向量。观众席可以直接复用 P4 的观看连接。

### 5–7

见 `docs/TODO.md` 的对应条目；第 2 轮试玩可以用 `scripts/playtest/mcp.ts` 让多个 Agent 同时玩，结果写进 `docs/PLAYTEST.md` 第 2 节。

## 还没在真实环境里验证的（按风险排）

1. 桌面客户端在 macOS / Windows 上的安装与运行（CI 只保证能构建）。
2. 真显卡上的帧率（这里只有软件渲染 SwiftShader，所有帧率数字只看方向）。
3. 使魔（内置 Agent）调用真实 Claude API 的延迟与花费。
4. 局域网发现跨真实路由器/交换机（这里只在一台机器的回环和单网段上测过）。

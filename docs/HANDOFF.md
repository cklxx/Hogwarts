# 在你自己的电脑上接着做（从零开始）

按顺序做完第 1–4 步，然后把第 5 步的提示词粘给本地的 Claude Code。

## 1. 装工具（一次）

| 工具 | macOS | Windows | 用途 |
|---|---|---|---|
| Git | `xcode-select --install` | <https://git-scm.com> | 必需 |
| Node.js 22 | `brew install node@22` 或 <https://nodejs.org> | <https://nodejs.org> | 必需 |
| GitHub CLI | `brew install gh` | `winget install GitHub.cli` | 推送代码（也可以用 SSH key） |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | 同左 | 本地 Agent |
| Rust | <https://rustup.rs> | 同左（再装 VS Build Tools 的「C++ 桌面开发」） | 只在改 `desktop/` 时需要 |
| Java 21 + Lean | 见 `.github/workflows/ci.yml` 的 formal 任务 | 同左 | 只在改内核规则时需要（CI 也会跑） |

## 2. 克隆并配置 git 用户

```bash
git clone https://github.com/cklxx/Hogwarts.git
cd Hogwarts
git config user.name  "cklxx"
git config user.email "<你 GitHub 账号用的邮箱>"
gh auth login            # 选 GitHub.com → HTTPS → 用浏览器登录
gh auth setup-git        # 让 git push 用 gh 的登录
```

（用 SSH 的话：`git remote set-url origin git@github.com:cklxx/Hogwarts.git`，并把公钥加到 GitHub。）

## 3. 装依赖并确认一切正常

```bash
npm ci
npx tsc --noEmit && npx vitest run && npx vite build     # 应该全绿（435 个测试左右）
npm start                                                # 打开 http://localhost:7777 玩一下，Ctrl+C 停
```

## 4. 让本地 Claude Code 也能进游戏（可选，试玩时用）

```bash
npm start &                                              # 服务器在后台跑着
claude mcp add -s user hogwarts -- npx tsx "$PWD/src/mcp/stdio-bridge.ts" http://localhost:7777/mcp
```

或者装桌面客户端（CI 的「Desktop client」工作流产物，或 `cd desktop && npm ci && npx tauri build`），在启动器里点「添加到 Claude Code」。

## 5. 提示词

在仓库目录里运行 `claude`，粘贴下面这段。它会自己读计划、按顺序做、每项做完提交推送。

```text
你是霍格沃茨这个仓库的开发 Agent，接手继续开发。先读 CLAUDE.md、docs/PLAN.md、docs/TODO.md，然后：

1. 跑 `npx tsc --noEmit && npx vitest run && npx vite build`，确认起点是绿的；不绿先修。
2. 按 docs/PLAN.md「顺序」一节，从第一个还没完成的事项开始（第 1 项「桌面客户端真机验收」需要我在旁边操作，
   跳过它，除非我说现在做）。每次只做一项。
3. 每一项：先把做法和要改的文件列给我看（三五行就够），我没反对就开始；
   按 docs/TODO.md 里这一项的验收标准写测试，测试先能复现问题 / 描述新行为；
   改内核规则或常量时同步 formal/ 并跑 formal/run.sh；
   性能相关的改动把前后数字写进 docs/PERF.md。
4. 做完：三项检查全绿 → 更新 docs/TODO.md（移到「已完成」，写提交号）和 docs/PLAN.md →
   提交（信息写清楚做了什么、为什么、怎么验证的）→ git push。大功能用 wf/<名字> 分支，做完 merge --no-ff 回 main 再推。
5. 然后告诉我：做了什么、怎么验证的、还有什么没验证、下一项是什么；等我说继续再做下一项。

界面文字中文优先（L('中文','English')），密钥永远不打印。不确定需求时问我，不要猜。
```

### 只做某一项时

把上面第 2 步换成一句具体的，例如：

- 「只做 docs/PLAN.md 里的『P4 看 Agent 玩（观战）』，按那一节的做法和 docs/TODO.md 的验收标准。」
- 「只做『试玩遗留：经验平衡 + NPC 垫人』。先起一个本地服务器，用 scripts/playtest/mcp.ts 自己玩 15 分钟，记下刷怪和考试每分钟各得多少经验，再改。」
- 「只修 docs/TODO.md『遗留问题』里的第 N 条：先写一个能复现它的测试。」
- 「用 scripts/playtest/mcp.ts 开 5 个不同性格的 Agent（新手、刷子、代码高手、政客、捣蛋鬼）在本地服务器上玩 3 个学期，把无聊、困惑、兴奋的时刻记进 docs/PLAYTEST.md 第 2 节，再按结果提改动建议。」

### 做桌面客户端真机验收时

「照 docs/PLAN.md 第 1 节，一步一步带我在这台电脑上验收桌面客户端：你来运行命令、看日志，需要我点的地方告诉我点哪里；有问题就修，修完重新打包再验。」

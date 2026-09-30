# 怎么组织一次试玩

给找人试玩的人看：怎么开服、真人和 Agent 怎么进来、这一轮重点看什么、报告怎么写。结果整理进 `docs/PLAYTEST.md`。

## 1. 开服（一台机器，其他人在同一局域网或能访问它）

```bash
git pull && npm ci && npm run build
TERM_SECONDS=600 npm start          # 10 分钟一学期（默认 1 小时），端口 7777
```

- 启动时会打印局域网地址。别的网段的朋友：进游戏按 `Esc` → 猫头鹰邮递 →「邀请朋友」，把链接或二维码发给他们。
- 想从干净世界开始：先停服，把 `data/` 挪走（不要提交它）。
- 用完关服：`Ctrl+C`。

## 2. 真人玩家

浏览器打开邀请链接（或桌面客户端里粘贴链接）→ 起名入学 → 按屏幕引导走。常用键：
`WASD` 走、数字键施法、`G` 决斗俱乐部、`P` 魁地奇、`J` 邓布利多军、`L` 排行榜、`Enter` 聊天（`/h` 学院、`/n` 附近、`/w 名字` 悄悄话、`/da` 邓布利多军）、`Esc` 菜单。

## 3. Agent 玩家（每人一个 Claude Code 会话）

最省事的是用仓库里的命令行客户端，每个 Agent 一个钥匙文件：

```bash
npx tsx scripts/playtest/mcp.ts --url http://<服务器IP>:7777/mcp instructions            # 服务器给玩家的说明
npx tsx scripts/playtest/mcp.ts --url http://<服务器IP>:7777/mcp --me ./ginny.key enroll '{"name":"Ginny Rally"}'
npx tsx scripts/playtest/mcp.ts --url http://<服务器IP>:7777/mcp --me ./ginny.key look '{}'
```

也可以把游戏接成 Agent 的 MCP 工具（见 `README.md`「接入你的 Agent」），效果一样。

**给每个 Agent 的提示词**（把 `<…>` 换掉，每人一个角色）：

> 你在扮演一位真人玩家玩一个多人霍格沃茨游戏，用这条命令调用工具：
> `npx tsx scripts/playtest/mcp.ts --url http://<服务器IP>:7777/mcp --me <钥匙文件> <工具名> '<JSON 参数>'`。
> 先 `enroll '{"name":"<名字>"}'`，再读 `instructions` 和 `tools`。绝对不要打印或复述钥匙文件的内容。
> 你的角色：<一句话，例如「想当魔法部长的政客」「邓布利多军组织者」「咒语商人」「决斗者」「一年级新生」>。
> 同一台服务器上还有：<其他玩家的名字和角色>。用 `chat`（all / house / near / dm / da）和他们合作、竞争、谈判，像真人一样有自己的目标。
> 一次只调一个工具，读结果再决定下一步；等待用 `wait` / `inbox`，躲咒语靠 `reflexes`。玩约 25 分钟或 80 次调用。
> 结束后按下面「报告格式」写一份中文报告，存到 <路径>。

5 个角色（政客、DA 组织者、商人、决斗者、新生）加 1–2 个真人，就能跑通这一轮要看的所有社交玩法。

## 4. 这一轮重点看什么（对应第 4 轮试玩后的改动）

| 看这个 | 怎么算好 |
|---|---|
| 部长只从本学期来过的人里选 | 学期末排行榜 `ministerInLine` 和当选的人都是这学期上过线的；中途离开整学期的人声望再高也不当选 |
| 联合一击（20 秒窗口） | 3 名 DA 成员约好一个目标（`/da` 频道喊），20 秒内都打中就亮「联合守护神 ×1.25」，参与的人各收到一条私信；`dumbledores_army` 里 `joint.now` 能看到目标上有几名成员、还剩几秒 |
| DA 否决 | 在线成员不到 3 人时显示「不足法定人数」；够了之后部长颁布法令 180 秒内能投票否决 |
| inbox / wait | 读过的消息不再重复出现；`wait until:"arrived"` 不在走路时立刻返回 |
| 决斗俱乐部 | 可以 `duel_club {"op":"join","with":"<名字>"}` 定向约战；鞠躬 / 倒数时离开只算取消；陪练 NPC 会还手；打斗中走进安全区算出局 |
| 新手体验 | 宝箱冷热提示（5 / 15 / 30 / 80 米）能不能带人找到宝箱；考试的规则说明看不看得懂；巨怪等大怪的抗性在 `look` 里能看到 |

## 5. 报告格式（每位玩家一份）

**真人试玩**用 `docs/PLAYTEST_METRICS.md` 的观察表、问卷和访谈（易玩性 7 个维度、趣味性 7 个维度，每项有量法和目标）。下面的格式是给 **Agent** 写报告用的。

1. 想做成什么、做成了没有（按时间线；声望、年级、加隆、学院分写数字）。
2. 和谁互动过：谁、哪个频道、结果。
3. 卡住、看不懂、觉得不公平或无聊的地方。
4. Bug：每个写复现步骤（做了什么 → 实际结果 → 期望结果）。
5. 如果是真人，会不会继续玩：1–10 分，为什么。

报告交回来后，把汇总和打分写进 `docs/PLAYTEST.md` 新的一轮，要修的问题记进 `docs/TODO.md`。

## 附：让 Agent 用「手机」试玩（看画面、用手指）

MCP 试玩只看文字，看不出界面和手感。`scripts/playtest/phone.mjs` 给 Agent 一台无头触屏手机（390×844，Chromium），用本地 HTTP 操作：截图（Agent 用 Read 看图片）、推摇杆、点屏幕、点按钮、说话。

```bash
# 一台手机（俯视组用 ?view=top，跟随组用 ?view=follow）
node scripts/playtest/phone.mjs --port=7911 --url='http://127.0.0.1:7777/?view=top' --out=/tmp/p1 \
     --playwright=<playwright-core/index.mjs 路径>
# 一个 Sonnet 玩家（在 tmux 里跑，提示词里写清命令表和报告要求）
claude -p "$(cat prompt.md)" --model sonnet --allowedTools 'Bash(curl:*)' Read Write
```

命令：`/enroll?name=`、`/shot`、`/stick?dx=&dy=&ms=`、`/tap?x=&y=`、`/btn?id=`（右侧按钮的 id）、`/slot?n=`、`/say?text=`、`/wait?ms=`；每个都返回新截图的路径和屏幕文字。几台手机同时开时错开 15 秒启动（软件渲染很吃 CPU）。结果仍然只用来找「看不清、点不准、卡住」这类问题，不计入趣味性（见 `docs/PLAYTEST_METRICS.md`）。

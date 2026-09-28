# 猫头鹰邮递：Agent 链路设计（v0.8）

> 本文件是实现规格。三块功能：**A 密钥与自动重登**、**B 彩蛋：只凭登记号寄东西（含诅咒）**、**C 玩家 ↔ 自己的 Agent 对话**。
> 原则不变：20 Hz 单写者内核；MCP 工具与 WS 消息都只是 `World` syscall 的薄适配层；所有闭环逻辑有 TLA+ 模型 + Lean 证明 + 一致性向量。
> 本版由三份独立方案评审合成，再经对抗式审查修订后裁剪而成（删掉了 OAuth、配对二次审批、48 位登记号、npx 发布、inbox socket 唤醒等过度设计）。

## 0. 身份模型（不变的部分）

每个巫师有三个标识：

| 标识 | 例子 | 性质 |
|---|---|---|
| token（猫头鹰邮递密钥） | `r0.Xk2…`（REALMS 时带领域前缀） | **唯一凭证**。永不出现在 snapshot / look / 事件 / who[] / 日志 / 错误信息里 |
| registry 登记号 | `wz_1a2b3c4d` | 魔法部公开记录，"知道就能寄包裹"——彩蛋的钥匙。靠探索获得（活点地图、Revelio） |
| handle | `p12` | 公开，用于 3D 客户端与瞄准 |

## A. 密钥：Agent 记住自己，每次新会话自动回来

### A.1 三条持久化路径（按推荐顺序）

1. **stdio 桥（全自动，推荐）** `src/mcp/stdio-bridge.ts`
   - 启动：`npx tsx src/mcp/stdio-bridge.ts http://host:7777/mcp`（URL 也可用 `HOGWARTS_URL`），`npm run owl -- <url>` 同义。
   - 钥匙串：`~/.hogwarts/credentials.json`（目录 0700、文件 0600；Windows 用 `%APPDATA%\hogwarts\`），按 MCP URL 的 `origin+pathname` 分键：
     `{ "version":1, "keys": { "http://host:7777/mcp": { "token", "registry", "name", "savedAt" } } }`
   - 取钥顺序：`HOGWARTS_TOKEN` 环境变量 → 钥匙串 → 无（未登录，等 `enroll`/`pair`/`login`）。环境变量里的 token 首次成功后也写入钥匙串。
   - 拦截：`enroll` / `login` / `pair` / `rotate_key` 成功后解析结果里的 `token`，**先原子写入（tmp+rename）再**把模型可见文本里的 token 替换成 `"(已保存到 ~/.hogwarts/credentials.json)"`；写失败则原样透传并在 stderr 警告。
   - 断线重连：服务器重启后旧 MCP 会话失效（HTTP 400 / "No valid MCP session" / 未绑定提示），桥**重建 transport 并用钥匙串 token 重新 initialize**，然后重试这一次调用。
   - 状态只写 stderr：`hogwarts: playing as <name> (<registry>)`，永不打印 token。
   - 转发 `instructions`；推送通道见 C.4。
2. **HTTP 直连 + 配置头**：`claude mcp add -s user --transport http hogwarts <url> -H 'Authorization: Bearer ${HOGWARTS_TOKEN}'`（单引号，存的是字面 `${…}`），在 shell profile 里 `export HOGWARTS_TOKEN=…`。`.mcp.json` 同理。
3. **Agent 自己记**：HTTP 直连且没配头时，`enroll`/`pair`/`login` 的结果带 `remember` 字段，明确要求 Agent 把 token 写进自己的持久记忆（Claude Code：`~/.claude/CLAUDE.md` 或项目 memory），并说明下次会话先 `login`。`INSTRUCTIONS` 首段写明：「若本会话未绑定巫师：先在你的记忆里找猫头鹰邮递密钥并调用 login；找不到就请人类在游戏里生成配对码」。

### A.2 配对码（最少步骤、零复制长 token）

- 浏览器 Esc「猫头鹰邮递」→ 点 **[生成配对码]** → 显示 `ABC-DEF`（字母表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`，31 字符，6 位，空间 31^6 ≈ 8.9 亿），倒计时 180 秒。
- 人对 Agent 说一句：「连上霍格沃茨，配对码 ABC-DEF」。Agent 调 `pair({code})`：绑定本会话、返回 `{ok, name, house, registry, token, remember}`（桥自动保存）。
- 浏览器立即显示「✅ Claude Code 已连接」（来自 C.3 的在线状态）。**不做二次审批**：码单次有效、180 秒过期、每个巫师同时只有一个活码、失败限速，暴力破解期望成功率可忽略（Lean 证明上界，见 A.5）。
- 限速：`pair` 失败每 IP 每分钟 10 次、每领域每分钟 30 次；`login` 失败每 IP 每分钟 20 次。内核 `redeemPairCode(code, source)` 按来源（服务器传客户端 IP）计数：已超每 IP 上限的来源**先被拒绝、不计入领域额度**，所以锁住整个领域至少要 3 个来源（Lean `realm_lock_needs_sources`，TLA `RealmLockNeedsSources`）。权衡：领域额度满时连正确的码也被拒（这正是 `GuessesBounded` 成立的原因），3 个以上 IP 持续乱试仍能让全领域 1 分钟内无法配对；可接受，因为浏览器里的密钥与 `login` 不受影响。
- REALMS：多领域时码带领域前缀 `2-ABC-DEF`；前门按前缀把 MCP 会话迁到对应领域（复用 `login` 跨领域迁移会话的同一钩子）。单领域时无前缀。
- 反方向（Agent 先注册）：`enroll` 结果的 `play` 链接改为 `http://host/#k=<token>`（fragment 不会发给服务器、不进日志）；网页 gate 读取 `#k=`（兼容旧 `?token=`）后立刻 `history.replaceState` 抹掉。

### A.3 换钥（泄露后的补救）

- MCP `rotate_key`（`destructiveHint`）与浏览器 **[更换密钥]**（二次确认）：生成新 token，旧 token 立即失效；向该巫师的所有 WS 连接推送 `{t:'token', token}`（浏览器更新 localStorage）；关闭该巫师的**其他** MCP 会话（不关调用者）。
- 内核新增 `tokenIndex: Map<token, wizardId>`，`byToken` O(1)；`restore()` 重建；`rotateToken(wid)` 维护。
- WS `welcome` 不再带 `token`（客户端本来就有）。

### A.4 MCP 工具变更

| 工具 | 变化 |
|---|---|
| `enroll` / `login` | 结果加 `remember`（持久化指引，含三条路径）与 `connect`（bridge 命令 / claude mcp add / .mcp.json 模板，均用 `${HOGWARTS_TOKEN}` 而非明文） |
| `pair` 新 | `{ code: string(6..12) }` → 绑定会话。描述：「用游戏里猫头鹰邮递显示的 6 位配对码绑定你的巫师；无需 token。」 |
| `rotate_key` 新 | 无参；返回新 token 与 `connect` |
| `whoami` | 增加 `agents: { sessions, clients }`（会话数由 main.ts 扫描 `mcpSessions` 得出，不维护计数器）；永不含 token |

### A.5 形式化

- `formal/tla/Pairing.tla`：码状态 `fresh → used | dead`，时钟；动作 `Mint`、`Redeem`、`Expire`、`Guess(source)`（受每窗口失败上限与每来源上限约束）。不变式 `CodeSingleUse`、`ExpiredNeverRedeemable`、`AtMostOneLivePerWizard`、`GuessesBounded`、`SourceBounded`、`RealmLockNeedsSources`；活性 `EveryCodeSettles: fresh ~> (used ∨ dead)`（`WF(Expire)`）。
- Lean：`pair_guess_bound`：窗口内命中数 ≤ 尝试上限 × 活码数 / 空间（以自然数不等式表述，空间 = 31^6）；`vectors` 输出 `PAIR_SPACE`，`test/formal.test.ts` 与 `PAIR_ALPHABET.length ** PAIR_LEN` 比对。

## B. 彩蛋：有登记号就能寄——礼物，或者诅咒

> 发现过程仍是彩蛋：`forge_item` 描述依旧说 `wizard_id` 是「你的登记号」，grimoire 不提负数和恶咒。
> 第一层（已有）：写别人的登记号 → 礼物寄过去（韦斯莱漏洞）。
> **第二层（新）**：给别人寄的物品里写负数 → 诅咒物品；在 `lore` 里写恶咒咒语 → 包裹一打开就中咒。

### B.1 登记号从哪来（靠玩，不白给）

1. 活点地图（已有，3 分钟内显示所有人的登记号）。
2. **Revelio 复仇链**：被匿名诅咒后，对自己施放「原形立现 Revelio」会揭示你箱子里每件匿名诅咒物品的寄件人姓名与登记号（私信事件）。
3. 堵住意外泄露：WS 广播的事件去掉 `who` 字段（客户端只用 zh/text）；Runes 的 `num`/`after` 等错误信息里的 `#wz_…` 走 `refName` 打印成 `@Name`；`resolveTarget` 不再接受别人的原始 `wz_…` 作为施法目标（防止拿 cast 当存在性探针；对战目标仍用 handle / 名字 / 坐标）；`armory` 对匿名物品隐藏 `forgedBy/forgedByName`。
4. 未知登记号与受保护目标返回**同一句**拒绝：「锻造炉不肯往这个登记号投递。」`forge_item` 失败每会话每分钟 ≤ 12 次。

### B.2 诅咒物品（负数属性）

- `forge_item.mods` 的 schema 从 `z.number().min(0)` 放宽为 `z.number()`。
- 给**自己**锻造时负数仍然报错（`${k} must be ≥ 0`），行为不变。给**别人**时允许负数，下限 `NEG_LIMITS = { maxHp:-30, maxMana:-30, manaRegen:-3, speed:-20, power:-15, ward:-20 }`；正负不能混（「诅咒不能同时是祝福」）。
- 点数按 `|v| × 每点价格` 计入寄件人的年级预算，价格另加 `HEX_MALICE_TAX = 3` 金加隆；预算与箱子上限（`MAX_ITEMS`）始终检查。
- 到达时：若对应槽位**空着**，诅咒物品自动穿上并**粘身** `CURSED_ITEM_BIND_S = 300` 秒（期间不能卸下、不能销毁）；槽位有东西就只躺在箱子里（无害）。粘身期满自动解除，之后就是一件普通的烂物品。
- 解除粘身：对自己施放「咒立停 Finite Incantatem」立刻解除；或等 300 秒。

### B.3 恶咒（lore 里的咒语）

`parseJinx(lore)` 识别原著咒语（不区分大小写），强度与时长由内核决定（输入无法放大）：

| 关键词 | 恶咒 | aura | 效果（上限） |
|---|---|---|---|
| `Locomotor Wibbly` / `Jelly-Legs` | 软腿咒 腿脚发软 | `jelly` | 移速 −40%，20 秒 |
| `Tarantallegra` | 塔朗泰拉舞 | `dance` | 移动方向轻微乱跳（确定性抖动 `hash(tick, handle)`，不动全局 RNG），20 秒 |
| `Furnunculus` | 火疖子咒 | `boils` | 每秒 3 点伤害，12 秒 |
| `Bat-Bogey` | 蝙蝠精咒 | `bats` | 每秒 3 点伤害 5 秒 + 沉默 |
| `Langlock` | 锁舌封喉 | 沉默 | 不能施法、不能公开说话 |

- 所有恶咒 aura 都是 `debuff:true`，**实时计算，不进 `derived()`**（不碰 wf/perf 的 derived 缓存键）。`afflicted()` 改为读 `AURA_DEFS[k].debuff`。
- aura（与沉默）的 `src` 永远是寄件人。每个效果（伤害 tick、软腿、乱舞、沉默）都问 `World.jinxBites(src, victim)` = `canHarm(null, victim)`（受害者在场、不在安全区）∧ PvP 规则允许寄件人伤害受害者（PvP 开；同学院需友伤）。**不看寄件人站在哪**：寄件人走进大礼堂不会让恶咒暂停，否则受害者能借此推断寄件人的位置。`canHarm(src, victim) ⇒ jinxBites`（3000 个随机世界复查）。
- 伤害上限：每个 tick 经过所有乘数（规则、受害者的 ward）后再截到表内速率（`hexTickDmg`，Lean `hex_tick_capped`）——诅咒的负 ward 不能把 3/秒 放大。
- 恶咒伤害地板：hex DoT 不会把生命压到 `max(1, 25% maxHp)` 以下，且**不刷新** `hurtAt/lastHurtBy`（不打断回血、不制造一击必杀）。
- 沉默：每次 ≤ 5 秒，之后 20 秒内新的沉默直接丢弃（永远有施法窗口）；`silencedUntil / silenceCdUntil / silenceBy / silenceSrc` 持久化，冷却跨重启、跨被击倒复活保留。沉默只挡 `cast` / 公开 `say` / `use_item`；**猫头鹰（C 部分）、`listen`、`simulate_spell` 永远可用**。
- 移动地板：`1 − chill − jelly ≥ 0.25`，永远能挪。
- 咒立停（cleanse）清掉全部恶咒 aura 与沉默，并给 60 秒「喘息」免疫（`respiteUntil`）。

### B.4 公平闸门（单一函数 `guardHostileGift`，TLC 与 Lean 都针对它）

hostile = `(有负数属性 ∨ 有恶咒) ∧ target ≠ forger`。任何一条不满足都拒绝（未知/受保护目标用同一句通用拒绝）：

- 寄件人：非 NPC；年级 ≥ 2；入学满 `FRESH_SECONDS`（600 秒）。
- 收件人：非 NPC；年级 ≥ 2；入学满 600 秒；**在线**；**不在安全区**；不在喘息期；**PvP 规则允许寄件人伤害他**（PvP 关闭或同学院且无友伤时拒绝，同一句通用拒绝，不扣钱）。寄件人在哪不影响（猫头鹰哪儿都能飞）。
- 收件人身上活跃恶咒 < 3；诅咒物品数 < 2；粘身诅咒物品 < 1（只针对负数物品）；10 分钟内收到的恶意包裹 < 3（所有寄件人合计）。
- 同一寄件人对同一收件人冷却 300 秒。
- 寄件人付得起（物品价 + 恶意税）。金加隆守恒：寄件人减少量 = 价格 + 税，收件人不变。

### B.5 发现者的祝贺

- 第一次成功寄出恶意包裹：私有成就「黑魔法 The Dark Arts」（声望 0，只通知本人，不公开广播，避免时间关联去匿名）。
- 全服第一个：私信「🎉 你第一个发现：锻造炉不止能寄礼物——写上任何登记号，诅咒照寄不误。」`flags.curseFoundBy` 记名。
- 线索（面包屑）：`hogwarts_a_history` 增一条弗雷德和乔治的趣闻（寄给珀西一件每小时缩一码的毛衣）；grimoire 的物品段落只写「属性的下限」而不写负数用法。

### B.6 数据模型

```ts
// Item +
cursed?: boolean; bound?: boolean; boundUntil?: number; anon?: boolean;
jinx?: { kind: JinxKind; mag: number; seconds: number };
// WizardStatus +
silencedUntil: number; silenceCdUntil: number;
// Wizard +
hexLog: Record<string, number>;   // 收件人 id → 上次恶意包裹时间（写入时清理过期项）
hexWindow: number[];              // 收到的恶意包裹时间（10 分钟窗口）
respiteUntil: number;
// AURA_KINDS += 'jelly' | 'dance' | 'boils' | 'bats'
```

### B.7 derived() 地板（顺带修掉潜在的负数属性隐患）

`maxHp ≥ max(40, 60% 年级基础)`，`maxMana ≥ max(20, 50% 基础)`，`manaRegen ≥ 50% 规则值`，`speedMult ≥ 0.5`，`power ≥ 0.25`（伤害永远不会变成治疗），`ward ∈ [−0.25, 0.5]`。地板是 `derived` 输入的纯函数，不需要改缓存键。

### B.8 形式化

- `formal/tla/Hex.tla`：一个收件人、若干寄件人（含未满条件者与同学院者）；动作 `SendHex(s)`（完全按闸门）、`Tick`、`Cleanse`、`Destroy`、`Earn`（寄件人重新赚钱）、`Decree`（切换 PvP）、安全区 / 在线切换。不变式：`HexCountBounded`、`CursedItemsBounded`、`BoundBounded`、`WindowBounded`、`HpFloorUnderDot`、`MovableAlways`、`SilenceNeverPermanent`、`FreshAndNpcImmune`、`RulesRespected`；动作性质 `SafeSuspends`、`RulesSuspend`、`SenderPays`、`PairCooldownHolds`、`RespiteHolds`、`CastingWindow`。
- `formal/tla/HexLive.tla`（扩展 Hex）：活性 `EventuallyClean`、`EventuallyCanCast`（只有 `WF(Tick)`），在真实常量保持的比例下检查——窗口容纳的包裹数 × 最长效果 < 窗口长度（`LeavesGaps`；Lean `hexes_leave_gaps`：3 × 20 秒 < 600 秒），且每个恶咒 / 沉默持续 ≥ 2 tick，所以成立靠的是闸门而不是时钟：去掉窗口子句 TLC 会找到永远有恶咒的反例。
- `Hostility.tla` 不变；`test/formal.test.ts` 的 3000 个随机世界加上带恶咒 aura 的实体，重查全部敌意不变式。
- Lean：`hp_floor`、`mana_floor`、`speed_floor`、`move_floor`、`power_pos`（⇒ 伤害非负）、`ward_bounded`、`manaregen_floor`、`hex_dot_floor`、`hex_cost_pos`；所有常量与若干采样进入 `vectors`，TS 侧比对。

## C. 玩家 ↔ 自己的 Agent

### C.1 你在浏览器里玩，怎么跟 Agent 说话

- **猫头鹰面板**（按 `O`，或聊天框以 `@agent ` / `@a ` 开头）：私密对话，只在你和你的 Agent 之间。未知的 `@词` 前缀会先问「发到公共频道还是给 Agent？」防止误发。
- Agent 的回复与提问出现在面板里，并在屏幕上弹出提示；提问带按钮（2–4 个选项），点了就回给 Agent。
- **在线状态小组件**（HUD）：「🤖 Claude Code 已连接 · 3 秒前：move_to · 目标：去禁林打八眼巨蛛」。
- **接管**：你按 WASD 或点地面走路时，Agent 设的目的地立即取消（人永远优先）。反过来 Agent 的 `move_to` 在你按着方向键、你点的目的地还没走到、或你上次操作后 `PLAYER_GRACE_S = 2` 秒内都会被拒（`PLAYER_STEERING`）；Agent 的 `stop` 只停它自己设的目的地。HUD 有 **[暂停 Agent]** 开关：暂停时内核拒绝该巫师 MCP 会话的所有动作类调用（只允许 look / whoami / events / armory / grimoire / leaderboard / listen / tell_player / set_goal_note），Agent 收到「你的主人暂停了你」。

### C.2 数据模型与内核

```ts
// Wizard + （序列化，重启后保留）
owlbox: { id: number; from: 'player' | 'agent'; text: string; t: number;
          ask?: { options: string[]; expiresAt: number }; answered?: boolean; answer?: string }[];  // ≤ 50
owlSeq: number; agentReadUpTo: number; agentGoal: string | null;
// Wizard + （不序列化）
agentPaused: boolean; agentSeen: { client: string; tool: string; at: number } | null;
// WorldEvent + from?: 'player' | 'agent'；EventType += 'owl' | 'ask' | 'curse'
```

- `owl(wid, from, text, ask?)`：≤ 400 字，每巫师每分钟**每一方**（玩家、Agent 分别计）≤ 30 条——话多的 Agent 用不掉主人的额度；箱满（50）时淘汰最旧的**已结束**消息，**未回答的提问永不被淘汰**，**Agent 还没读的主人来信也最后才淘汰**：Agent 的新消息永远挤不掉它（箱里只剩未读来信与未答提问时拒绝，`OWLBOX_UNREAD`：先 `listen`）；只有主人更新的来信能挤掉最旧的未读来信，且不是悄悄丢：被挤掉的条数记在下一封未读来信的 `lost` 上，Agent 收信时看到，主人收到一次私信提示。发出私有事件 `to=wid, from`。
- `answerAsk(wid, id, choice)`：选项必须属于该提问、未过期（45 秒）、未回答过；否则拒绝。`tick` 把过期提问标记为 `answer='(expired)'`。
- `wait` 的 `mine()` 修正：包含 `to===me` 的私有事件，但**排除 `from==='agent'`**（Agent 自己的话不会唤醒自己）。
- 在线状态走 `privateState()`（`me` 消息，逐 socket、变化才发），**不进 `snapshot()`**（fanout 会丢弃新顶层键）；`at` 取整到 5 秒，避免 `me` 每 tick 抖动。

### C.3 MCP 工具（Agent 侧）

| 工具 | 说明 |
|---|---|
| `tell_player` | `{ text, options?: string[2..4] }`。发给你的主人（私密，不是公共聊天）；带 options 即提问，回答通过 `listen` / `wait` 收到 |
| `listen` | `{ seconds?: 0.5..45 }` 长轮询：返回主人新发来的猫头鹰（与提问的回答），推进水位线 |
| `wait` | `seconds` 上限 15 → 45；新增 `until:'owl'`；事件带 `from` |
| `confirm_with_player` | `{ question, timeout_seconds?: 5..45 }` → `{ approved }`。浏览器在线就在游戏里弹确认；否则若客户端支持 elicitation 就在终端问；都不行返回 `{ approved:false, reason:'no human reachable' }`。拒绝 / 取消 / 超时一律 `false` |
| `set_goal_note` | `{ goal: string ≤ 80 | null }`，显示在主人 HUD 上 |
| `decree` | `dry_run:false` 时若主人可达（浏览器在线或 elicitation 可用），先 `confirm_with_player`；被拒绝则不颁布 |

MCP 会话的 `clientInfo.name`（如 `claude-code`）在 initialize 时记录，用于 HUD 显示；每次工具调用更新 `agentSeen`。

### C.4 推送：让 Agent 在你说话时"醒来"

三级，按可用性自动降级；**正确性只依赖第 3 级**，推送只影响"何时醒来"：

1. **Claude Code channels（研究预览，经 stdio 桥）**：桥声明 `capabilities.experimental['claude/channel'] = {}`，后台每 2 秒 `GET /api/owls?since=<id>`（Bearer token；不算在线心跳），有主人新消息就发 `notifications/claude/channel`，`params: { content: "🦉 主人说：…", meta: { kind: 'owl', id: '<n>' } }`。服务器名必须是 `hogwarts`。启用：`claude --dangerously-load-development-channels server:hogwarts`（可选，文档里标明是研究预览）。
2. **elicitation**：仅用于 `confirm_with_player` 在终端向人确认（永不用于索要密钥）。
3. **可移植长轮询**：任何 MCP 客户端都能用 `listen` / `wait(until:'owl')`。INSTRUCTIONS 建议 Agent 空闲时 `listen`。

### C.5 WS 消息

客户端 → 服务器：`{t:'owl', text}`、`{t:'answer', id, choice}`、`{t:'paircode'}`、`{t:'rotate'}`、`{t:'pause', on}`，以及物品面板用的 `{t:'destroy', item}`（`equip`/`unequip` 已有）。全部加入 `net.ts` 的 LIMITS。
服务器 → 客户端：猫头鹰 / 提问 / 诅咒走已有的私有 `event`；`{t:'paircode', code, expiresIn}`；`{t:'token', token}`；Agent 在线状态走 `me.agent`。

### C.6 界面（中文优先）

- **猫头鹰邮递菜单（Esc）重做**：第一屏是 **[生成配对码]** 和一句「对你的 Agent 说：连上霍格沃茨，配对码 XXX-XXX」；下面是一行 bridge 命令（推荐）与 HTTP 配置头命令（用 `${HOGWARTS_TOKEN}`）；密钥默认隐藏在 **[显示密钥]** 后；**[更换密钥]**（确认后旧钥立即失效）；你的登记号，旁注「登记号是魔法部的公开记录，猫头鹰凭它投递包裹。」
- **猫头鹰面板**（O）；**行囊面板**（T）：物品列表，穿/卸/销毁；诅咒物品显示「🔒 被诅咒（粘身，剩 N 秒）」；按钮「念咒立停解咒」（不会该咒语时置灰并说明「需 2 年级」）与「念原形立现，看看是谁」。
- **诅咒横幅**：「⚠️ 有人给你下了黑魔法：腿脚发软 · 火疖子（每秒 −3 生命，不会打晕你）。解除：念「咒立停 Finite Incantatem」；进安全区会暂停；或者等它消退。想知道是谁？念「原形立现 Revelio」。」
- 新手引导第 5 步改为「连接你的 Agent」（配对码 + 一句话）；第 6 步（Agent 已连接时才出现，可跳过）「按 O 和你的 Agent 说句话」。
- 帮助面板加 `O` / `T`；`O`/`T` 在输入框聚焦时不响应。aura 字母与颜色：jelly 淡紫、dance 品红、boils 黄绿、bats 灰；沉默显示「🤐」。
- `i18n.ts` 的 `tr()` 增加新错误的中文。

### C.7 形式化

- `formal/tla/Owl.tla`：有界信箱 + 提问 / 回答 / 过期。不变式 `BoxBounded`、`UnansweredAskNeverEvicted`、`AnsweredAtMostOnce`、`AnswerIsAnOption`、`AgentNeverEvictsUnread`、`UnreadNeverSilentlyLost`；活性 `AskEventuallySettles: asked ~> (answered ∨ expired)`（`WF(Tick)`）。
- `formal/tla/Control.tla`：`paused ∈ BOOLEAN`、人类输入、Agent 目标。不变式 `PausedBlocksAgent`、`HumanInputClearsAgentGoal`、`PlayerGoalIsThePlayers`（Agent 既不覆盖也不取消玩家点的目的地）；动作性质 `AgentWaitsItsTurn`；活性 `HumanCanAlwaysReclaim`。

## D. 工作包与文件边界

| 包 | 拥有的文件 | 交付 |
|---|---|---|
| **K 内核 + 形式化** | `src/kernel/*`、`src/shared/constants.ts`、`src/runes/*`（仅 refName 修复）、`src/lore/history.ts`、`formal/*`、`test/{identity,curse,mailbox,formal,kernel,systems}.test.ts` | A.2/A.3 的内核 API（`tokenIndex`、`rotateToken`、`mintPairCode`、`redeemPairCode`）；整个 B；C.2 内核；全部 TLA+/Lean/向量；`formal/run.sh` 全绿 |
| **M MCP + 服务器 + 桥** | `src/mcp/*`、`src/server/*`、`scripts/bot.ts`、`package.json`（仅加 `owl` 脚本）、`test/mcp.e2e.test.ts`、`test/bridge.test.ts` | A.1 桥钥匙串 / 重连 / 拦截；A.4 工具；C.3 工具；C.4 推送（桥 + `/api/owls`）；C.5 WS；限速；REALMS 配对码路由；`sessionsOf`；换钥关闭其他会话 |
| **U 客户端** | `client/main.ts`（菜单、面板、HUD、网络消息；**不碰** apply 里的模型 / 特效段）、`client/controls.ts`、`client/index.html`、`client/i18n.ts`、`client/style.css`、`client/models.ts`（只在 aura 颜色表加项） | C.6 全部；gate 读 `#k=` |

顺序：K 先落地（M、U 以它的 API 为准），M 与 U 并行；最后合并进 `integration/v07`，与 v0.7 画面分支一起整体验证。

## E. 常量（`src/shared/constants.ts`，TS / Lean / TLA 共用）

```ts
PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; PAIR_LEN = 6; PAIR_TTL_S = 180;
PAIR_FAIL_PER_IP_PER_MIN = 10; PAIR_FAIL_PER_REALM_PER_MIN = 30; LOGIN_FAIL_PER_IP_PER_MIN = 20;
HP_FLOOR = 40; HP_FLOOR_FRAC = 0.6; MANA_FLOOR = 20; MANA_FLOOR_FRAC = 0.5; MANAREGEN_FLOOR_FRAC = 0.5;
SPEED_FLOOR = 0.5; MOVE_SLOW_FLOOR = 0.25; POWER_FLOOR = 0.25; WARD_MIN = -0.25; WARD_MAX = 0.5;
NEG_LIMITS = { maxHp: -30, maxMana: -30, manaRegen: -3, speed: -20, power: -15, ward: -20 };
CURSED_ITEM_BIND_S = 300; HEX_MIN_YEAR = 2; HEX_PAIR_COOLDOWN_S = 300; HEX_MALICE_TAX = 3;
VICTIM_HEX_CAP = 3; VICTIM_CURSED_ITEMS_MAX = 2; VICTIM_BOUND_CAP = 1; VICTIM_HEX_PER_10MIN = 3;
HEX_RESPITE_S = 60; SILENCE_MAX_S = 5; SILENCE_COOLDOWN_S = 20; HEX_HP_FLOOR_FRAC = 0.25;
FORGE_FAIL_PER_MIN = 12;
JINX_DEFAULTS = { jelly: {mag: 0.4, seconds: 20}, dance: {mag: 1, seconds: 20}, boils: {mag: 3, seconds: 12},
                  bats: {mag: 3, seconds: 5}, langlock: {mag: 1, seconds: 5} };
OWLBOX_MAX = 50; OWL_MAX_CHARS = 400; OWL_PER_MIN = 30; ASK_TTL_S = 45; LISTEN_MAX_S = 45; PLAYER_GRACE_S = 2;
```

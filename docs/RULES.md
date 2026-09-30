# 宪法：不能被打破的规则

霍格沃茨的大部分东西都可以改：法令改规则书，插件加玩法，界面随便换皮。**但下面这些不行**。每一条都写明：由哪段代码强制，由哪个形式化证明（`formal/`）或测试守着。新功能（包括新插件）不得违反其中任何一条；要加一条新的「不能破」，就把它写进这里，并配上证明或测试。

规则书（`src/kernel/rulebook.ts`）里的每个数都有宪法上下限：法令只能在上下限之内改（TLA+ `TermDecree` / `DAVeto` 的 `RulesWithinConstitution`，Lean `decree_stays_constitutional`）。下面的规则连法令也改不了。

## 1. 账号与密钥

| 规则 | 在哪里强制 | 证明 / 测试 |
|---|---|---|
| 密钥（猫头鹰邮递密钥）只走请求头或 WebSocket 子协议 `hw-key.`，不进地址、不进日志、不打印；地址里带 `?token=` 一律 401 | `src/server/key.ts` | `test/mcp.e2e.test.ts`（地址带密钥被拒） |
| 任何人说出、写下自己的密钥都会被拦下：MCP 参数、聊天、猫头鹰都一样 | `src/mcp/server.ts` `KEY_IN_ARGS`、`src/kernel/chat.ts` | `test/mcp.e2e.test.ts`、`test/chat.test.ts` |
| 一个名字只属于一个巫师：大小写、空格和标点、重音、全角、形似字母都算同一个名字 | `World.enroll` + `nameKey`（`src/kernel/identity.ts`） | `test/chat.test.ts` |
| 别人的注册号（`wz_…`）不能拿来当目标或私聊对象，查不出它存不存在 | `World.resolveTarget` | `test/kernel.test.ts` |
| 配对码只能用一次、会过期、每人同时只有一个；猜码次数有上限 | `World.redeemPairCode` | TLA+ `Pairing`，Lean `pair_guess_bound` 等 |
| 换钥后旧钥立刻失效 | `World.rotateToken` | `test/mcp.e2e.test.ts` |

## 2. 公平：弱者不被碾

| 规则 | 在哪里强制 | 证明 / 测试 |
|---|---|---|
| 安全区里谁也伤不到谁；被击晕的人不能再挨打 | `World.canHarm` | TLA+ `Hostility`（`SafeZonesAreSafe`、`StunnedUntouchable`） |
| 新入学的巫师有保护期；恶咒和诅咒包裹碰不到新人和 NPC | `NEWCOMER_WARD`、`src/kernel/hex.ts` | TLA+ `Hex`（`FreshAndNpcImmune`） |
| 恶咒永远不能把人打到昏迷，也不能让人永远不能动、永远说不了话 | `hexDot`、沉默冷却 | Lean `hex_dot_never_stuns`、`always_moves`；TLA+ `Hex`（`MovableAlways`、`SilenceNeverPermanent`） |
| 属性再怎么被削也有下限（生命、法力、速度、伤害） | `src/kernel/progression.ts` | Lean `hp_floor`、`mana_floor`、`speed_floor`、`power_pos` |
| 决斗俱乐部里只有对手之间能互相伤害：2v2 的队友互相打不到，出局的人碰不到也不会被碰，外人不能打、不能治 | `World.canHarm` 的决斗分支（`duelFoes`） | TLA+ `Hostility`（`DuelMutual`、`DuelTeammates`、`DuelIsolated`） |
| 人永远优先：你一操作，Agent 立刻让路；暂停 Agent 后它只能看、能说话 | `World.setInput`、Agent 控制 | TLA+ `Control` |
| 黑魔法也要过伤害判定：夺魂咒永远不能用在巫师身上（谁的意志都不能被夺走），厉火只烧 `canHarm` 允许烧的 | `src/kernel/dark.ts` | `test/dark.test.ts` |
| 插件带来的 Runes 原语和内核自带的一样：受年级和封印门槛、法力上限、法令禁用的约束 | `registerPrims`、`FEATURE_SPELLS`（`src/kernel/magic.ts`） | `test/dark.test.ts`，TLA+ `CastTxn` |

## 3. 奖励有上限：刷不爆

| 规则 | 在哪里强制 | 证明 / 测试 |
|---|---|---|
| 每人每学期能加的学院分有上限，学院分永远不为负 | `src/kernel/housecup.ts` | Lean `cup_term_bounded`、`cup_deduct_nonneg`、`house_points_bounded` |
| 决斗声望：同一对手 10 分钟一次，每学期最多 5 场 | `src/kernel/duelclub.ts` `duelGrant` | Lean `duel_club_term_bounded` |
| 魁地奇的声望和学院分都有上限 | `qdRep` / `qdCup` | Lean `qd_rep_bounded`、`qd_cup_bounded` |
| 集市版税：每人每咒语每天一次，每日有总上限，不给自己付、不给 NPC 付 | `src/kernel/market.ts` | TLA+ `Market`，Lean `royalty_*` |
| 校园事件同时最多一件，奖励只发一次 | `src/kernel/wheel.ts` | TLA+ `EventWheel` |
| 施法是原子的：法力不够就整段不生效，也不扣法力；法力永远不为负 | `src/kernel/magic.ts` | TLA+ `CastTxn`，Lean `commit_spends_exactly`、`fizzle_is_free` |
| 偷声望有比例上限，决斗中声望守恒 | `src/kernel/unfair.ts` | Lean `steal_*`、`duel_conserves*` |
| 野生魔物一击最多打掉你最大生命的 40 %（事件加强过的也一样）：满血至少要挨三下才会倒 | `CREATURE_HIT_CAP`、`World.damageInner` | Lean `creature_hit_capped`、`creature_two_blows_survive` + 向量，`test/round4.test.ts` |
| 施法打不到就不扣法力：目标不在了、中间有墙、对方打不得，都当场拒绝，法力分文不动 | `World.cast` | `test/round4.test.ts`（TLA+ `CastTxn` 的「失败不扣」） |
| O.W.L. 只认真正的效果：伤害、治疗、护盾每个至少 5 点才算数（挠痒痒式的「做了」不算），判卷反馈说出哪些太弱 | `EFFECT_MIN`、`src/kernel/exams.ts` 的 `mine()` | `test/exams.test.ts`（已知漏洞写法必须挂） |
| 指定了目标的咒语只打目标：路过的人和魔物不会被误伤，也不会收到来袭预警 | `World.stepProjectiles`、`World.threats` | `test/combat-round2.test.ts` |

## 4. 政治

| 规则 | 在哪里强制 | 证明 / 测试 |
|---|---|---|
| 每学期最多一位部长、一道法令；只有部长能颁布法令 | `World.endTerm` / `World.decree` | TLA+ `TermDecree` |
| NPC 永远当不了部长，也当不了黑魔王 | `World.endTerm`、`darkLordEligible` | TLA+ `TermDecree`（`NPCsNeverRule`） |
| 被附身的 NPC 还是 NPC：照样当不了部长，打不到新生、残血和低好几个年级的人；附身的人拿不到任何奖励 | `src/kernel/possess.ts`（`hit` 钩子用 `npcMayFight`） | `test/agents.test.ts` |
| 邓布利多军每学期最多否决一次，只能在窗口期内、只能在达到法定人数时否决 | `World.vetoDecree` | TLA+ `DAVeto` |
| 被集市禁令禁掉的咒语谁都施放不了，物品上的咒语也一样；禁令被否决后恢复 | `bannedListing` | TLA+ `Market`（`BannedNeverCast`、`VetoRestoresBan`），`test/market.test.ts` |
| 老魔杖全服只有一根 | `src/kernel/world.ts` | TLA+ `ElderWand` |

## 5. Agent

| 规则 | 在哪里强制 | 证明 / 测试 |
|---|---|---|
| Agent 的行动类工具要消耗专注力（部长可以用法令关掉，这是一项政治选择）；读取和跟主人说话永远免费 | `spendConcentration` | Lean `focus_bounded`、`spend_focus_exact` |
| 猫头鹰邮箱有上限，但没读的信不会被悄悄丢掉；一个问题只能回答一次，答案必须是选项之一 | `World.owl` | TLA+ `Owl` |

## 其余都可以改

- **规则书**：部长用法令在宪法上下限内改（`decree` 先 `dry_run`）。
- **玩法**：新玩法写成插件（内核一个 `Feature`，浏览器一个 `ClientFeature`），不改内核也能加。
- **界面**：客户端插件、主题和布局都可以换。
- **数值**：平衡调整写进 `docs/PLAYTEST.md`，并附上模拟数据。

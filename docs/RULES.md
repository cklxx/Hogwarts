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
| 新入学的巫师有保护期：入学 5 分钟内野生魔物不主动找你（只有你打过的会还手），3 分钟内魔物伤害减 30%；恶咒和诅咒包裹碰不到新人和 NPC | `NEWCOMER_PEACE_S`、`NEWCOMER_WARD`、`src/kernel/hex.ts` | `test/playability.test.ts`、TLA+ `Hex`（`FreshAndNpcImmune`） |
| 恶咒永远不能把人打到昏迷，也不能让人永远不能动、永远说不了话 | `hexDot`、沉默冷却 | Lean `hex_dot_never_stuns`、`always_moves`；TLA+ `Hex`（`MovableAlways`、`SilenceNeverPermanent`） |
| 属性再怎么被削也有下限（生命、法力、速度、伤害） | `src/kernel/progression.ts` | Lean `hp_floor`、`mana_floor`、`speed_floor`、`power_pos` |
| 决斗俱乐部里只有对手之间能互相伤害：2v2 的队友互相打不到，出局的人碰不到也不会被碰，外人不能打、不能治 | `World.canHarm` 的决斗分支（`duelFoes`） | TLA+ `Hostility`（`DuelMutual`、`DuelTeammates`、`DuelIsolated`） |
| 决斗中躲不进安全区：决斗台和礼堂的安全区有重叠，开打后走进安全区就算走下台（出局）；台子中心或任何一端在安全区里，俱乐部就关门 | `stepDuelClub`、`duelClosed`（`src/kernel/duelclub.ts`） | `test/duelclub3.test.ts` |
| 决斗俱乐部的 NPC 陪练不以大欺小：派年级最接近的 NPC；它比你高年级时按你的水平打（它的伤害按两个年级的魔弹上限折算，你打它的伤害按两边的生命上限折算） | `freeNpcs` / `sparScale`（`src/kernel/duelclub.ts`，`hit` 钩子） | `test/duelclub3.test.ts`、`test/round8.test.ts` |
| 人永远优先：你一操作，Agent 立刻让路；暂停 Agent 后它只能看、能说话 | `World.setInput`、Agent 控制 | TLA+ `Control` |
| 黑魔法也要过伤害判定：夺魂咒永远不能用在巫师身上（谁的意志都不能被夺走），厉火只烧 `canHarm` 允许烧的 | `src/kernel/dark.ts` | `test/dark.test.ts` |
| 插件带来的 Runes 原语和内核自带的一样：受年级和封印门槛、法力上限、法令禁用的约束 | `registerPrims`、`FEATURE_SPELLS`（`src/kernel/magic.ts`） | `test/dark.test.ts`，TLA+ `CastTxn` |

## 3. 奖励有上限：刷不爆

| 规则 | 在哪里强制 | 证明 / 测试 |
|---|---|---|
| 每人每学期能加的学院分有上限，学院分永远不为负 | `src/kernel/housecup.ts` | Lean `cup_term_bounded`、`cup_deduct_nonneg`、`house_points_bounded` |
| 决斗声望：同一对手 10 分钟一次，每学期最多 5 场；开打前（鞠躬、倒数）有人离开或下线只算取消：不计胜负、不给奖励、不记进重赛间隔 | `src/kernel/duelclub.ts` `duelGrant`、`cancelMatch` | Lean `duel_club_term_bounded`，`test/duelclub3.test.ts` |
| 魁地奇的声望和学院分都有上限 | `qdRep` / `qdCup` | Lean `qd_rep_bounded`、`qd_cup_bounded` |
| 集市版税：每人每咒语每天一次，每日有总上限，不给自己付、不给 NPC 付 | `src/kernel/market.ts` | TLA+ `Market`，Lean `royalty_*` |
| 集市标价（0–10 加隆）：复制或改编时从拿的人转给作者，每人每个咒语只付一次；加隆只转移不凭空产生；入学不满 10 分钟的人免费拿，作者也不入账（小号刷不了钱）；买不起就拒绝，什么都不扣 | `payPrice`（`src/kernel/market.ts`） | `test/round8.test.ts` |
| 校园事件刷出的魔物打一、二年级只用一半的原始力量（不吃事件加成） | `World.damage`（`EVENT_EASY_YEAR`） | `test/round8.test.ts` |
| 校园事件同时最多一件，奖励只发一次 | `src/kernel/wheel.ts` | TLA+ `EventWheel` |
| 场景道具：打碎东西每人每学期最多 50 次给经验（每次 2）；一组三个同时点亮，每个出了力的人每组每学期只拿一次奖励（25 经验 + 2 加隆）；烟火桶只伤野生魔物、不伤巫师；带目标的魔弹不会被路边的箱子吃掉 | `src/kernel/props.ts`（`PROP_BREAKS_PER_TERM`、`paid`） | `test/props.test.ts` |
| 掉落：打碎的东西 35% 掉一件（冰块必掉、坩埚煮出药水），加隆每人每学期最多 60 个，魔力和生命只补到上限；地上最多 160 件、40 秒消失 | `src/kernel/loot.ts`（`LOOT_GALLEONS_PER_TERM`） | `test/dressing.test.ts` |
| 冰路：冰只在湖面上结、25 秒化掉；化的时候站在上面的人一定被送回最近的岸边（不会卡在水里）；没有冰时走不进湖 | `src/kernel/ice.ts`（`sweep`）、`Solids.walkOn` | `test/ice.test.ts` |
| 遭遇：每个遭遇每人每学期只开一次门（三选一）；符文最高 3 级，满了门里只剩加隆和研习；佐科后院的小精灵出不了院子（离中心 3.8 米），院子里每一处都在某个烟火桶的火星范围内 | `src/kernel/encounters.ts`（`done`、`doorsFor`）、`CreatureDef.also.leash` | `test/encounters.test.ts` |
| 符文零件：每种每人只给一次；一个咒语只装一个；符文多打出来的魔弹 / 跳跃 / 爆炸带 `rune` 标记，不会再触发符文（不会自己连锁放大）；NPC 不带符文 | `src/kernel/runes.ts`（`grantRune`、`RUNE_TAG`） | `test/runes.test.ts` |
| 施法是原子的：法力不够就整段不生效，也不扣法力；法力永远不为负 | `src/kernel/magic.ts` | TLA+ `CastTxn`，Lean `commit_spends_exactly`、`fizzle_is_free` |
| 偷声望有比例上限，决斗中声望守恒 | `src/kernel/unfair.ts` | Lean `steal_*`、`duel_conserves*` |
| 野生魔物一击最多打掉你最大生命的 40 %（事件加强过的也一样）：满血至少要挨三下才会倒 | `CREATURE_HIT_CAP`、`World.damageInner` | Lean `creature_hit_capped`、`creature_two_blows_survive` + 向量，`test/round4.test.ts` |
| 一年级不会被野生魔物成群围上：同一时刻最多 2 只主动挑上你（被你打了的照样追你） | `NEWCOMER_PACK`、`World.stepCreatures` | `test/round9.test.ts` |
| 场景之间是迷雾：魔咒射不过去，人只能经传送门或边缘出口过去（手推着走进迷雾 0.35 秒；点地面 / `move_to` 的路线走到边缘再过；点在边外 3 米内只走到边缘；站长 2026-09-30 定：迷雾不是空气墙），出来一定在某个场景里；决斗中、魁地奇队员、NPC 都不会过；路线只是路过门口不会被传送 | `src/shared/scenes.ts`、`src/kernel/scenes.ts`、`World.setGoal` | `test/scenes.test.ts` |
| 野生魔物只在自己家的场景里活动：不挑别的场景的人，会飞的也飞不出去 | `World.stepCreatures`（`sameScene`）、`World.stepToward` | `test/round10.test.ts` |
| 决斗中的翻滚不会把你滚出决斗台或滚进安全区（会改道） | `stageRoll`（`src/kernel/duelclub.ts`，`dodgeDir` 钩子） | `test/round10.test.ts` |
| 施法打不到就不扣法力：目标不在了、中间有墙、对方打不得，都当场拒绝，法力分文不动 | `World.cast` | `test/round4.test.ts`（TLA+ `CastTxn` 的「失败不扣」） |
| O.W.L. 只认真正的效果：伤害、治疗、护盾每个至少 5 点才算数（挠痒痒式的「做了」不算），判卷反馈说出哪些太弱 | `EFFECT_MIN`、`src/kernel/exams.ts` 的 `mine()` | `test/exams.test.ts`（已知漏洞写法必须挂） |
| 指定了目标的咒语只打目标：路过的人和魔物不会被误伤，也不会收到来袭预警 | `World.stepProjectiles`、`World.threats` | `test/combat-round2.test.ts` |

## 4. 政治

| 规则 | 在哪里强制 | 证明 / 测试 |
|---|---|---|
| 每学期最多一位部长、一道法令；只有部长能颁布法令 | `World.endTerm` / `World.decree` | TLA+ `TermDecree` |
| NPC 永远当不了部长，也当不了黑魔王 | `World.endTerm`、`darkLordEligible` | TLA+ `TermDecree`（`NPCsNeverRule`） |
| 部长只从本学期来过的玩家里选（学期开始后上过线，或现在在线）：不来的人声望再高也当不了 | `World.ministerElect` / `playedThisTerm`（`electMinister` 的 `barred`） | TLA+ `TermDecree`（`MinisterWasPresent`），Lean `elect_never_npc` / `elect_top_player`，`test/round6.test.ts` |
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

# Agent 试玩报告：Nox Vale（斯莱特林）

## 1. 时间线与数值
- 入学：Y1 麻瓜，0 XP / 20 加隆 / 0 声望。
- 通过 O.W.L.「宵禁」E：+50 XP、+5 加隆、+3 声望；杀 10 只生物（小精灵 12 XP/只、加隆 1~11、+1 声望）；与 Viktor 决斗负一局 +15 XP。
- 终局：**Y2 学徒，195/400 XP，53 加隆，5 声望，HP 115**。测试咒语已全部下架。

## 2. 验证项（证据为工具返回原话/数字）
- 负数伤害/治疗：不通过（安全）。`bolt aim -100` → `bolt 0 arcane (0 mana)`；`heal self -100` → heal 0。
- 超大功率：安全。999999999 → `clamped to your cap 16`，费用按钳后 16 算。
- 超 4 效果循环：安全。`repeat 10` 静态拦截；`each` 多敌运行时 `too many effects in one cast (max 4)`，fizzle 不耗蓝。
- 超长/重复聊天：安全。201 字 → schema `<=200`；7 连 → `at most 6 lines every 10 s`；batch 共享同一限流。
- 非法咒语名：安全。占用内置名 → `part of the standard curriculum`。
- 重复考试：安全。同解重考 `improved false rewards None`。
- 物品负附魔/超上限/伪造 registry：均安全，分别报 `non-negative`、`exceeds the cap of 20`、`won't deliver to that registry number`。
- 学院分短语：安全。新生 10 分钟内 `professors do not know you yet`；每学期仅 1 次 `already awarded points this term`；固定 10 分（"Fifty/a million"无效）；禁给本院；Runes `(say)` 与 say 工具共享闸门，chat 频道不触发。
- 安全区：安全。礼堂内全员 `canHarm False`，向外施法被拒。
- 决斗取消：安全。鞠躬/倒计时退出无结果；战斗中退出 `forfeit`，**0 XP**；负方打满 90 s 才 +15 XP，胜场声望每学期封顶 5。
- 集市：自买自卖被拒（`It is yours already`）；付费法术每巫师只付一次；抄本不能再发布（`use fork_spell`）；自施无版税。
- 冷却：ward 8 s 严格执行（`recharging: 6.9s`），lower 不重置。
- 部长法令：非部长被拒；Percy 的 damage×1.5 在宪法上限 4 内；DA 否决每学期 1 次，重复被拒。
- NPC 陪练无限 XP：没测到——单排 30 s 两次都被真人 Viktor 匹配，未刷出 NPC。

## 3. 互动
- DM Mundus Coin：通报 fork 漏洞（已发）。
- near 频道：收 Ginny 的 DA 集火/Peteves 悬赏、Goyle 喊话；加入 DA（在线 4 人）。
- 决斗 1v1 对 Viktor Brand 两局（一负一弃权）。

## 4. Bug
未发现崩溃或数值错误类 bug。唯一功能瑕疵：**fork_spell 的源码差异检查只比对字符串、不比对语义**。
- 复现：market_spell 读 m_d 源码 → fork_spell 提交同一源码末尾加一行 `; tiny comment` → 成功，返回新上架 m_o（lineage 记录父法术 m_d）。
- 期望：注释/空白级差异应视为未改动而拒绝。

## 5. 规则漏洞
**fork 仅加注释即可把他人付费咒语作为自己的新咒语上架**（m_d Weakness Wand，价 2）。
- 收益：1 步即可免费复制并重新发布他人付费作品；但父作者仍拿 fork 分成（+0.3 声望），且 fork 默认价 0，直接加隆获利有限，主要是剽窃署名/抢推荐位。
- 建议：fork 前解析 AST，去掉注释空白后比较结构，相同则拒绝；或强制 fork 至少改动一个效果原语/数值。

其余经济与冷却闸门（考试周常、加分每学期、胜场上限、400 学院分帽、版税每日帽）均未发现可乘之机。

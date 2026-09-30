# 设计方向重审（2026-09-30）

站长：「地图太大、东西太少……思路上还是有些问题」。本文先看获大奖 / 最火的游戏怎么做，再对照我们，给出新方向和第一刀。结论先写：

**我们一直在做加法（多一个玩法 = 多一个插件），得奖的游戏在做乘法（几条简单规则 × 世界里所有东西）。我们最独特的东西——咒语就是代码——恰好是天然的乘法系统，但它的威力玩家看不见：咒语打出去只是一个数字，世界不回应。** 所以下一步不是再加系统，而是把「施法 → 世界回应 → 组合出意外」这 30 秒做到极好，其余系统围着它转。

## 1. 它们怎么做的（只看得奖 / 最火的）

| 游戏 | 荣誉 / 热度 | 对我们有用的一条 | 来源 |
|---|---|---|---|
| 塞尔达：旷野之息 | 2017 年度游戏 | **乘法式玩法**：规则简单到一看就懂，又一致到能组合出复杂局面；物理引擎管「怎么动」，「化学引擎」管「状态怎么变」（火烧草起上升气流、冰冻住敌人、水浇灭火）。先用 2D 原型验证化学规则好玩，再做 3D | [Engadget GDC17](https://www.engadget.com/2017-03-12-breath-of-the-wild-gdc-talk.html)、[Thumbsticks](https://www.thumbsticks.com/gdc-17-breaking-conventions-breath-of-the-wild/)、[Gamereactor 2D 原型](https://www.gamereactor.eu/nintendo-showed-zelda-breath-of-the-wild-2d-prototype-at-gdc/) |
| 哈迪斯 | DICE 2021 年度游戏 + 游戏设计奖 | **设计先于故事**；房间是手工做的池子里挑出来的，每扇门都通向下一个房间（节奏）；房间里的陷阱学会了就成了你的武器；房间之间的小发现（金罐、宝库、钓鱼点） | [DICE](https://www.gamedeveloper.com/game-platforms/supergiant-s-i-hades-i-named-game-of-the-year-at-24th-dice-awards)、[Kotaku](https://kotaku.com/hades-level-design-is-less-random-than-it-seems-1845254545)、[Low Five](https://www.lowfivegaming.com/blog/ep-002-hades) |
| 宇宙机器人 | 2024 TGA 年度游戏 | **玩具的乐趣**：「我们想的是单纯玩一个玩具的快乐」，碰什么都有反应（旋转攻击旁边的螺旋灌木，它就跟着转一圈）；每个机制先单独做原型，好玩了再缝进关卡；关卡像游乐项目，讲「节奏和旋律」；「做个小游戏没关系」 | [TechRadar 访谈](https://www.techradar.com/gaming/astro-bot-nicolas-doucet-interview)、[Push Square](https://www.pushsquare.com/features/interview-the-making-of-astro-bot-the-ps5s-next-great-exclusive)、[Game Developer](https://www.gamedeveloper.com/design/-it-s-okay-to-make-a-small-game-astro-bot-director-nicolas-doucet-says-tiny-ideas-contain-huge-potential)、[THR](https://www.hollywoodreporter.com/business/digital/game-awards-winners-list-astro-bot-1236086029/) |
| 吸血鬼幸存者 | 2023 BAFTA 最佳游戏 + 游戏设计奖（赢了战神、艾尔登法环） | **极简操作 + 持续变强**：只有移动，攻击自动，升级让它更频繁、更强、更大；新手马上觉得自己在指挥混乱 | [NME](https://www.nme.com/news/gaming-news/vampire-survivors-wins-best-game-at-bafta-games-awards-3423827)、[TechXplore](https://techxplore.com/news/2023-04-vampire-survivors-gambling-psychology-bafta-winning.html) |
| 光环 | 系列销量级 | **30 秒乐趣**：「光环 1 大概有 30 秒的乐趣反复出现」；实际是 3 秒循环套 30 秒循环套 3 分钟循环 | [Engadget 访谈](https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html)、[Mac McCormick](https://imacmccormick.com/2016/09/30/design-principles-learned-from-playing-halo/) |
| 博德之门 3 | 2023 年度游戏 | **对玩家的创意说「行」**：「系统放在那里就是给你滥用的」；变成一团云能不能钻管子？系统做对了就能 | [PC Gamer](https://www.pcgamer.com/larian-studios-swen-vincke-is-loving-players-systems-based-hijinks-in-baldurs-gate-3-everybody-knows-about-the-owlbear-now/)、[Destructoid](https://www.destructoid.com/larian-founder-swen-vincke-on-dice-druids-and-baldurs-gate-3/) |
| 小丑牌 | 2024 年最火独立游戏之一 | **简单零件 × 叠加协同**：每张小丑牌一句话能读懂，三张一起就组合爆炸；「搭好你的鲁布·戈德堡机器，看它跑」 | [TouchArcade 访谈](https://toucharcade.com/2024/03/18/balatro-interview-mobile-port-localthunk-dlc-plans-updates-new-jokers-demo-feedback/)、[EJAW](https://ejaw.net/balatro/) |
| 原神 | 全球最火之一 | **元素反应是战斗核心**：蒸发、融化 ×1.5/×2，冻结、超导；学起来简单、组合有深度 | [TheGamer](https://www.thegamer.com/genshin-impact-elemental-reactions-ranked/)、[Game Rant](https://gamerant.com/genshin-impact-elemental-reactions-guide/) |
| 魔能 Magicka | 法术组合的经典 | 8 个元素最多叠 5 个，相克的不能叠，水 + 火 = 蒸汽；上千种组合 | [Wikipedia](https://en.wikipedia.org/wiki/Magicka)、[Magickapedia](https://magicka.fandom.com/wiki/Elements) |
| Noita | GDC 2019 演讲 | 每个像素都模拟的世界 + 可拼装的法杖，乐趣来自涌现 | [GDC Vault](https://www.gdcvault.com/play/1025695/Exploring-the-Tech-and-Design) |
| 艾尔登法环 | 2022 年度游戏 | **发现感**：「你找到了本不该找到的东西」的错觉；用醒目地标引导探索；看重密度与颗粒度 | [PC Gamer](https://www.pcgamer.com/games/rpg/hidetaka-miyazaki-erdtree-size-sense-of-discovery/)、[TheGamer](https://www.thegamer.com/elden-ring-open-world-design/) |
| 致命公司 / Among Us | 现象级多人 | **社交靠机制**：近距离语音、身份规则让玩家自己制造故事，机制比内容多重要 | [Game Design Library](https://www.gamedesignlibrary.com/post/proximity-chat-changes-the-game-how-lethal-company-s-game-design-innovated-multiplayer-horror-games)、[TheGamer](https://www.thegamer.com/proximity-chat-is-incredible-peak-repo-lethal-company-phasmophobia-among-us/) |
| 霍格沃茨之遗（反面） | 销量大、口碑两极 | 大家爱的是在城堡走廊和霍格莫德闲逛；被骂最多的是 95 个梅林试炼这类「打勾清单」式填充，和重复的战斗 | [Screen Rant](https://screenrant.com/hogwarts-legacy-merlin-trials-rewards-bad/)、[GamingBible](https://www.gamingbible.com/news/hogwarts-legacy-merlin-trials-783145-20230214) |
| 手感（通用） | GDC / Nordic Game 经典演讲 | 「Juice it or lose it」「The Art of Screenshake」：命中停顿 40–80 ms、按事件大小的镜头震动、粒子、声音——同一个原型加上反馈就活了 | [RPG Playground 综述](https://rpgplayground.com/research-making-a-juicy-game/)、[egmatic](https://egmatic.com/blog/how-to-make-your-game-feel-good) |

共同点，归纳成五条：

1. **先有 30 秒的乐趣，再有一切**（光环、吸血鬼幸存者、宇宙机器人先做原型）。
2. **乘法，不是加法**：几条一致的规则作用在所有东西上（旷野之息、原神、魔能、小丑牌）。
3. **世界要回应你**：碰什么都有反应，而且是按规则回应（宇宙机器人、旷野之息）。
4. **空间是为遭遇做的**：手工的房间 / 关卡，每一块都有目的，节奏像游乐项目（哈迪斯、宇宙机器人）；不要打勾清单（霍格沃茨之遗的教训）。
5. **对玩家的创意说「行」**，社交靠机制产生故事（博德之门 3、致命公司）。

## 2. 我们的问题在哪（诚实地）

| 他们 | 我们现在 |
|---|---|
| 一个核心动词做到极好 | 20 多个插件（学院杯、考试、集市、法令、决斗俱乐部、魁地奇、宝箱、画片、课表、黑魔王、邓布利多军、无规则区、飞路网……），每个都是「一个玩法 + 一份奖励」：**加法** |
| 30 秒循环本身就爽 | 走到小精灵旁边按 1，冒一个数字。没有命中停顿、没有击退、镜头不动；敌人不逼你换咒语 |
| 世界按规则回应魔法 | 刚开始有：场景道具（火盆、符文石、烟火桶）。但草不会烧、湖不会冻、敌人不会湿、魔鬼网不怕光——规则只在 61 个点上成立，不在世界上成立 |
| 咒语的组合就是乐趣本身（小丑牌、魔能、Noita） | 咒语是 Lisp 代码，威力很大，但入口是一个代码编辑器；新玩家看不到「写个更聪明的咒语」能换来什么，它的乐趣在界面背后 |
| 空间为遭遇服务 | 先是开放世界，后来压成场景，但场景里还是「地点 + 零散东西」，不是有目的、有节奏的遭遇 |
| 不做打勾清单 | 课表、宝箱、画片、每日目标：正是霍格沃茨之遗被骂的那类填充 |
| 社交靠机制 | 学院杯是记分板；两个人一起玩没有「一起才能做到」的事 |

还有一个流程问题：大作都先做一个小的、能验证乐趣的原型（旷野之息的 2D 原型、宇宙机器人的单机制原型），**我们没有「这 30 秒好不好玩」的衡量，只有「功能做完了、测试全绿」**。

## 3. 新方向：一个会回应魔法的世界 × 可组合的咒语

保留我们独有的两样——**咒语是代码**、**AI Agent 和人一起玩**——把它们放到正中间：

1. **魔法化学（乘法的核心）**。一张小表：元素 × 状态。
   - **状态**：湿、燃烧、冻结、带电、发光。
   - **作用对象**：玩家、魔物、道具、地面（草、水面、藤蔓）。
   - **组合反应**：火 + 湿 = 蒸汽（遮挡视线）；雷 + 湿 = 导电连锁；冰 + 湿 = 冻住（水面能走）；火 + 冻结 = 解冻爆裂；光 + 魔鬼网 = 退缩。
   - 规则写成一张数据表：内核（结算）、客户端（特效）、Agent（`look` 里读得到）共用这一份。
2. **手感**。
   - 命中：40–80 ms 停顿，按伤害大小镜头轻震。
   - 击退、受击闪白，元素各自有清楚可辨的特效。
   - 只动客户端，内核不变。
3. **咒语 = 可以拼的零件（小丑牌 / Noita）**。
   - 在代码之上加一层「符文」零件：分裂 ×3、追踪、连锁、延迟、命中时触发、改元素……每个一句话读懂。
   - 捡到、偷师、在集市买到符文，拖进咒语槽就能组合。编辑器把它们展开成 Runes 代码，想写代码的人和 Agent 照旧写。
   - 世界里的化学（第 1 条）就是这些组合的回报：「湿 → 雷 → 连锁」要自己搭出来。
4. **场景 = 遭遇**。
   - 每个场景围绕一个「玩具」设计：温室里是怕光怕火的魔鬼网；黑湖是冻出冰路；禁林是能烧的蛛网和蜘蛛群；球场是金色飞贼；霍格莫德是烟火桶连环炸。
   - 一次遭遇 2–5 分钟、目标清楚，打完在两三份奖励里挑一份（像哈迪斯的门）。
   - 课表、宝箱、画片退居二线：只留「遭遇里自然会做的事」。
5. **一起才能做到**。
   - 一人弄湿、一人放雷，配合打出的伤害比单人高；有些遭遇要两个元素同时到位。
   - Agent 可以是固定搭档：它会补你缺的那个元素。

## 4. 第一刀：一个垂直切片，先证明 30 秒好玩

**验收不看比例，看保证**（站长：「我们预期肯定是百分之百，只有百分之几完全不行。游戏的获客成本是 App 的几百倍，App 可以赌概率，游戏只能赢」）。每一条都写成：**不管新玩家怎么做，一定会在 N 秒内碰到 X**——靠关卡和规则本身保证（马里奥 1-1、旷野之息初始台地的做法），并用自动化试玩把每一条可能的路径走一遍验证，而不是抽样统计。

| 做什么 | 保证（每条路径都测） | 状态 |
|---|---|---|
| 化学表：湿、冻结（+ 内核的灼烧、冰冷），10 个反应；作用于所有巫师和魔物 | 规则一张表（`src/shared/chem.ts`），内核、客户端、Agent 共用；每个反应有测试 | ✅ `test/chem.test.ts` |
| 第一次遭遇：南草坪中间的喷泉让草地常湿，最早遇到的小精灵就住在里面；湿的目标被**任何**元素打中都会起反应，清水如泉（Aguamenti，一年级新咒语）打湿本身也有名字（湿透） | 新一年级从出生点出发，快捷栏上**每一个**攻击咒语（昏昏倒地 / 火焰熊熊 / 清水如泉）第一发打最近的小精灵，都一定出现有名字的反应 | ✅ 保证测试（3 条路径） |
| 手感：命中停顿（身边 45 ms、打在你身上 70 ms、反应 30–110 ms，按分量）、按大小震屏、反应名字大字弹出、湿的目标头顶水珠、冻住的套冰壳 | 每一次在你身边的命中都有停顿和震动；每一次反应都有名字和粒子 | ✅（真浏览器截图：草地上 NPC 打出「滑倒！」「冻结！」） |
| 3 个符文零件（分裂、连锁、延迟）拖进咒语就生效 | 新玩家前 10 分钟里一定会拿到一个零件、一定会被引导拖进一个咒语（引导步骤本身就是这一下） | 下一步 |
| 温室遭遇：魔鬼网 + 小精灵，要靠光、火、冰的组合 | 进温室的每个人第一次施法就遇到魔鬼网对光 / 火的反应 | 下一步 |

做到了再铺到另外四个场景；做不到就先改切片，不加新系统。

## 5. 先停什么

- 不再加新的独立玩法插件，直到切片过关。
- 课表 / 每日目标 / 画片这类清单不再扩充。
- 法令、集市、考试、魁地奇保留，不动。

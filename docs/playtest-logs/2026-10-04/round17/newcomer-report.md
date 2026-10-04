# 新手、导航、教学与成长：完整一小时真实 MCP 试玩

实际区间：**2026-10-04 11:16:11.635–12:17:22.226 UTC**，3670.591 秒（超过 61 分钟）。玩家 Hour-Newcomer / Hufflepuff；固定 main 54cd8e0、共享 http://127.0.0.1:7777/mcp、4 NPC、正常 20 Hz。未快进世界、改规则、改源码、另开服务器或读取世界私钥/封印生成器。全程没有浏览器名额，**UI、材质、相机、键鼠/触控、GPU 帧率未验证**。这份代理证据只用于 bug/规则和实际行为，不冒充真人 SUS/NPS 或“大众喜欢”的结论。

操作口径：1921 次已记录 MCP 工具调用（包含读取、等待与拒绝），其中 move_to 110、cast 171、wait 460；最终角色 stats.casts=233 含反射/批量等游戏动作，和单独 cast 工具次数不同。MCP isError 7 次，顶层语义 ok:false 29 次，批量内层拒绝未并入此数字。最终 KO=8、creatures=37。

## 结束状态

12:17:21 已 stop、清空自己的 reflexes、目标备注为试玩结束，在礼堂安全区 (-0.1,-51.7) 待机；所有个人驱动与 SDK 会话已经结束，未停止共享服务器。五年级 XP1401，HP180、mana180，2 道封印，Split2 / Chain1 / Burst2，全部未装备到咒语。普通护理袍仍装备，外观 spell 状态 velvet 已写入但渲染未验证。

第一学期四遭遇均实际完成、6/6 O.W.L. 优秀、7 个箱成功、7 张画片；自然进入第二学期后再开 pillar 箱，累计8个成功开箱/8张画片。新学期贡献5；第一学期本人贡献400/400，lost10。第一学期 Slytherin485 胜、Hufflepuff439、Gryffindor429、Ravenclaw85；等级/XP/画片/符文保留，声望248→124、贡献/遭遇进度正常重置。

## 可复现问题与恢复路径

### 1. 倒地时生成的同场景路线，复活换场景后仍继续执行（root 已独立复现）

1. 11:21:44 从城堡进入禁林；11:22:07 wait 返回 danger（HP106→27）并明确建议治疗/护盾/退回。
2. 最初驱动忽略 danger，11:22:08 蜘蛛 KO。这是测试者错误，不能称内核 Bug。
3. 倒地期间 move_to 接受了多个目标，最后 hagrid 从 forest 计算 continues:false 的同场景路线，目标约 (95,37)。
4. 复活到 courtyard 后继续原路线，11:22:25–41 在 castle 东边 (73.5,3.7→13.3) walking:false，未进入 forest。
5. 11:23:14 stop、15 活着重发 hagrid，正确生成跨场景 continues:true；11:23:19 真正到 forest (94.5,36.9)，满血。

期望：复活换场景应清理/重建旧路线，或倒地时拒绝新导航。实际：旧同场景目标跨到错误场景执行并提前终止。root 用独立 World fixture 复核，不快进本轮服务器；本轮未改内核规则。

### 2. 活着从球场回礼堂，在近墙点卡住（候选，和 KO 路线问题分开）

1. 11:55:02 pitch (38.6,-134.3)，骑扫帚后 move_to great_hall。
2. 跨到 castle 后到 (30.4,-63.1)，11:55:05–23 六次 wait3s 均 time、walking:true，坐标只挪约0.2m，HP165。
3. 11:55:24 stop、25 重发 great_hall；11:55:57 wait15s 仍只挪0.2m。11:56:06 卸扫帚后目标 (35,-68) 被合法修正 (35,-63)，仍卡；(40,-55)/(30.5,-59) 也没解开。
4. 11:56:58 stop + 合法 dodge(dx0,dz1) 后重发礼堂，11:57:07 真正 arrived，满血。

期望：活着的有效路线能走出近墙点，或明确报告受阻；实际持续 walking/time 无有效位移。疑似网格起点贴墙问题，未自行改代码或断言完整根因。可定位 snitch54-live.out / dodge57-recovery.out 与 UTC 动作。

### 3. 指定目标命中说明矛盾（文字问题）

真实 baseline grimoire 的 IN FLIGHT 说具名目标会击中“target or a foe in its path”，RULES 说只打具名目标。root 已修源文字与 README，本轮服务器仍 baseline。不是本次复现了误伤；没有要求改变公平命中规则。

## 实际路线与通关证据

- 11:16:11 首操作。初生 look 看不到小精灵只因距离：向南约4秒后6只湿 pixie 可见。11:16:38 第一发 Incendio、40 得 Split、41 装好，全血；“看不到目标”已排除为 Bug。
- Courtyard→Hall→seventh_floor→erised→dungeons→greenhouses 均 arrived；Erised 的 walkable 修正点及 where=Grounds 不直接称 Bug。
- 11:18:16 温室3/3，选第一门 Chain；11:19:48 合法二年级。实际原创火14已先模拟再铸造/施放，成本17.4一致。
- 海格 landmark 在约(95,37)，离壁炉(96,18)约19m，必须真正走到壁炉再 Floo。11:23:25 森林 broom×2，11:23:51 Hagrid→lake 正常。
- 夜湖自然冰路完成1/1但有死亡，不能当白天造路或无伤通过；wait idle/knocked_out 返回的位置在复活城堡，不冒称湖岸 arrived。
- 11:27 pitch→courtyard→hogsmeade→shack→courtyard 后续五段真实 arrived，修正早期没通过的路段。
- **白天冰路**：11:29:25 natural lake=shore；11:30:02 合法 Glacius 造路、06 到浮标(-100.7,39.9)，HP130。之后不重施冰，连续5秒观察；11:30:26 frozen、31 自然融冰送回岸(-87.5,39.8)、41 稳定 shore，HP130，没有卡水中。
- **佐科**：首次到院后停思考36秒被5只1m小精灵 KO（测试者）；第二次11:33:18 fresh zk-1 rest→火，20 五桶连炸/5pixie一起清，5/5、Split升2、HP145。最近受伤 Floo 正常拒绝1秒，改走正常路回Hall。
- **巢**：首轮曾误点装饰 forest-web、弹道被前方蜘蛛拦，真正6/9并正常回Hall；改站(134,36)，只选fresh web-N，11:49:29真正9/9、Burst升2，XP1052。11:49:38撤离仍因剩余蜘蛛/中毒与耗蓝 KO，通关与生存分开，累计KO7。
- **三灯**：Hall远射0/3、西侧14,-59只2/3，贴0.3m也没点第3盏，不能把cast.ok当命中。改站(22,-56)，12:01:36真实3/3、XP1054→1079；逐一Glacius灭0/3再Incendio重亮12:01:43的3/3，XP仍1079，单学期奖励不重复。前述受阻可能墙/道具截弹/起点越过，尚未fixture定位，不直接称 Bug；MCP提示反馈可改进是偏好。

## 编程、成长与预算

- 11:25:32 在Hall读公开 O.W.L. brief 与语言参考，独立编写条件、查询、延迟、召唤题；11:26:00 前4题均一次 O，XP510合法三年级；11:26:38 全6题一次 O。报告/对外简化日志省略完整源码，未读测试答案。
- 11:35:16 第一封印、11:38:59 第二封印各首次提交成功；只亲自到公开页地标读取并推导/正向验算，不读生成器/存档/私钥。不剧透完整解法或输入。静态大火模拟 cap34→37→40，第二封印前 chain 明确拒绝、之后可编译；无目标正常无效果/不扣蓝。
- 普通自己的护理袍 maxHp20/manaRegen1，9/22预算、27G，装备后maxHp145→165、regen8.5→9.5；use_item治疗18、mana20.7，合法自护，无向别人寄装备。
- 12:07 实际模拟 Field Care heal28/shield30×4s=60.4蓝；Travel Care heal16/shield12×2s=32蓝，12:08:16正式铸造并设low_hp/4秒/keep25%。不是无敌，也未声称长期胜率改善。
- 12:12:29 Vestimentum成功15蓝，appearance状态velvet/housegold；仅验证状态，无渲染结论。
- 12:14:58从fresh look确认弹道无巫师，单体打castle-crate-61，12:14:59加2XP，1399→1401、五年级、HP180；05回Hall，未为升级重复刷怪。

## 联机、事件、分配与失败

- **水→火合作**：11:42:58–45:24 与不同学院 Combat 具名野生蜘蛛配合，全卸 Split/Chain/Burst，不对彼此/任何巫师施攻击。首次人工/模型交接超过8秒wet，队友检查新鲜状态后没假称蒸发；改双驱动据MCP/DM立即施法。队友18次火成功、至少8不同蜘蛛32.4（12×弱点1.8×wet1.5），XP1413→1723、creatures139→147。我的水辅助XP817→817、creatures30→30、rep167→167，没有助攻成长；这是当前奖励设计观察，非直接 Bug。队友驱动45:18结束，我45:24被剩余蜘蛛 KO6，不能称整段零KO。
- **校园飞贼**：11:55:00–02实时look追踪、两发Stupefy具坐标瞄准且弹道避开巫师，真实捕获+150学院分/+20G/Baron稀有卡。Social已抓过，让新手体验此轮；不把校园0.5秒与魁地奇0.8秒混同。
- **宵禁**：Hall/七楼探索被Mrs Norris抓两次，总lost10，没有零抓60秒奖励，普通玩法失败，非 Bug。公开history开启活点地图看8人，擦除后确实空白；未利用登记号攻击/寄物，报告不列登记号。
- **Troll喊词错误**：11:59把公开喊词误当已有课本咒，18–37 unknown spell/0蓝/0伤，初始驱动没及时停止语义拒绝属测试者错误；已补处理。Social+Combat真实11:59:38击倒，我0贡献；43才铸造同名合法原创火，不能称三人输出。
- **喊词修正**：12:11:39–45对本轮fresh boss具名6发，各yourHits120（32×公开喊词3×Elder Wand1.25）；HP165、无符文/友伤。入场晚，12:11:46截止事件n18 lost、未击倒/无XP或奖励。51正常回Hall。
- **夜湖第二次失败**：12:08:18 Floo夜湖，look至少4摄魂怪/3阴尸12.6–14.9m；解读旧响应约13秒，首个12:08:32 whoami已复活castle，KO7→8。31 Patronum实际上在castle，不能称湖岸保护成功；未记录凶手，不按附近生物猜具体致死者。这是危险区停思考/旧状态驱动问题。
- **校园摄魂怪真实获胜**：12:13:23/30两次Patronum成功，相隔7.1秒，快驱动据fresh位置靠近，与Social同场守护。36最后摄魂怪退湖，n19 won、hero Newcomer；本人creatures34→37、XP1084→1399、持续2.2命中含down，HP165、KO8不变。Hufflepuff无人倒地，但本人cap400所以公告+0；仍得Wendelin稀有卡。42安全Hall。首段约12秒即结束，不推断70秒长期护法验证。

## 箱子、贡献上限与自然换学期

第一学期成功箱ID与时间：hall11:52:03（41G）、seventh11:52:40（Peeves）、greenhouse12:02:50（Marjoribanks）、willow12:03:08（21G）、broomsticks12:05:08（Shimpling）、shack12:05:23（Pokeby）、tomb12:09:28（Hagrid）。最初将Willow金币差误归Clock Tower，完整open_chest日志核对后已撤回，钟楼巡查没有开启成功。

8m/3.4m距离开箱都正常拒绝，实际到2.6m内再成功；雷达只粗定位，fresh look给精确箱位。12:08:43靠近白墓正常自动拾地上Elder Wand并得成就20rep，贡献393→400只记余7，未击晕或缴械别人；之后tomb仍给画片但学院分0，cap生效。

12:15:08最后8秒 finalMinute=true/×2，cap保持400；12:15:41自然term2，贡献0/lost0/4遭遇0未完成，等级/卡片/符文保留，声望248→124。12:16:44按fresh雷达实际打开**pillar**新学期箱（不是Hall箱），+5新贡献、Myrtle第8卡；49回Hall。

## KO 口径、未通过项、证据

最终8次KO：初次森林忽视danger1、早期夜湖2、夜庭院停思考1、首次Zonko停思考1、合作结束剩余蜘蛛1、巢撤离1、12:08夜湖旧look延迟1。路线重生 Bug 单独记录，不把这些驱动失误混进 Bug。没有证据说明所有失败都由同一生物造成。

未通过/未覆盖：本人宵禁零抓、本人Troll击倒（一次unknown、一次过晚失时限）、Room事件、本人魁地奇比赛、第三/四封印、长期护理方案胜率、所有GUI/材质体验。四遭遇第一学期实际通过，不因新学期0进度而否定之前通关。

持久证据：`actions-summary.jsonl`为对外简化UTC/参数/结果，省略登记号、封印输入、完整考试源码；`actions.jsonl`为私有完整定位，`final-summary.json`/`metrics-current.json`为最终口径。关键阶段out文件见对应命名：snitch54-live、dodge57-recovery、webs-finish-live、lamps61-side-live、troll71-live、dementors73-live、term75-live、newterm76-hallbox、final77-state。密钥只在单独0600 me.key，**不要归档密钥、含鉴权链接或Authorization**；未输出这些内容。

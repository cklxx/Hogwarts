# Seamus Finnigan 扮演记录

互动：欢迎新生 Lin Xiao、Qiu、Lao Wang、Jake，指路礼堂/决斗俱乐部，讲卡片、小精灵冰系弱点、反弹盾用 Expelliarmus 破、forge_item 要 mods 包一层。和 Goyle 魁地奇嘴仗。围观并点评多场新生决斗，两次喊人集火巨怪、魁地奇报名、摄魂怪用守护神。

打怪：地牢多只巨怪，Incendio 风筝；学会 aim_x/aim_z 坐标远程命中，事件大怪打掉约 830→消失。被巨怪/摄魂怪击晕数次。

Bug：
1. look 显示巨怪 dist 1.9m，cast 报 59–63m out of range，位置同时跳回庭院（怪消失/传送不同步）。复现：地牢贴脸巨怪时立即 cast。
2. SSH 桥接 Broken pipe，约 90 秒无响应，重连后附身已掉。
3. 附身期间被击晕复活后自动变宿主，需重新 take。

## 第二段（服务器重启后约 60 分钟）

互动：教 Lao Wang 楼梯口 20 米坐标瞄准风筝法；点评 Mia 129 点胜 Hannah、Jake 75s KO、Lin Xiao 16s 9 中 KO、Jake vs Lin Xiao 复仇局（点数 3:1，Lin 弹反三次）；提醒 Lin Xiao 防 Jake 新搓的 root+JakeBlast 连招；见证 Lin Xiao 升四年级搓群疗、Lao Wang 升三年级自带守护神；格兰芬多对拉文克劳魁地奇喊人并到场。

打怪：两次地牢巨怪风筝 Incendio，事件大怪各打数百伤害；决胜双倍期清 3 小精灵+1 魔鬼网。

Bug/异常：
1. 重启后 Seamus 咒语库被重置：27 个咒只剩 9 个一年级咒（Expecto Patronum、Bombarda 等全丢），HP/属性保留。复现：服务器重启后 armory。
2. 安全区边界判定：坐标点 (-30,-27) 报 safeZone 无法攻击怪，需再压到 (-38,-30)，但怪随即贴脸。
3. SSH 桥又一次 Broken pipe，批量循环 10 连时 120s 超时；附身再次静默失效。

## 第二天（约 60 分钟）

互动：点评 Mia 234 点胜 Lin Xiao（3 完美 Protego）、Mia&Seamus 2v2 胜 Jake&Lin Xiao（我贡献 303 伤）、Lao Wang 逼平 Padma；见证 Qiu 破第一封印、Mia/Qiu 两任部长、格兰芬多连庄学院杯；和 Goyle 全程嘴仗。三次喊人集火巨怪、喊魁地奇报名、教新人 ward 节奏。
打怪：湖边两波清阴尸+摄魂怪（守护神），温室四只摄魂怪两只守护神清场，多次地牢风筝巨怪 boss。
Bug：
1. Expecto Patronum 已在 armory，湖边贴脸 cast 报「You do not know」，重新 take 附身后恢复。复现：附身期间被击晕自动脱落后重接前咒语库不一致。
2. 事件巨怪 boss（1430/1560 血）对 Incendio 六发仅掉 18 血，只吃 Wingardium Leviosa 三倍。
3. 附身被击晕后静默变回宿主（共 4 次），宿主只有 2 血需先撤礼堂。
4. 一次 all 频道口误（应只用 near）。

## 第三天（约 60 分钟）

互动：和 Goyle 全程嘴仗并庭院真动手（反弹他一发）；围观 Mia 七番战点数再胜 Jake、Qiu vs 林晓；祝贺 Mia 升六年级、破第一封印（光荣之手）、连任部长；见证格兰芬多魁地奇 370:0、学院杯连庄（林晓 MVP 75 分）；教 Jake 守护神；跟 Mia 报名温室第二封印烧魔鬼网。
打怪：四次地牢巨怪事件，Reducto 风筝，单轮给 1560/1460 大怪打掉约 400，两只大怪被集火掉，清小巨怪/小精灵/魔鬼网十余；场地边放守护神救场。
更新变化：①新事件 peeves、room（有求必应屋，八楼三趟，前三得箱）；②化学状态（湿→冰冻结/碎冰×2、闪电感电连锁）；③打人柳三块雷符文石，亮窗约 2-3 秒，单人来不及，Qiu 说可用一咒三 bolt 同帧；④宵禁法令变常驻事件；⑤咒语库完好（28 个，第二天重置未复现）。
Bug：
1. wait until:arrived 后位置跳变（回庭院/黑湖），sleep 等真实移动走完才准。复现：move_to 远距离后立刻 wait arrived。
2. 施法间隙位置弹回，target 报 out of range 58m。
3. 附身被击晕/到期静默脱落，cast 误报「You do not know Reducto」，需重新 take（共 5 次）。
4. NPC 仍不能 open_chest/duel_club。

## 第 4 天（约 60 分钟）

互动：全程和 Goyle 嘴仗；点评 Mia 八番点数胜 Jake、Padma 209 点教林晓反弹、Jake 86 点胜林晓；教林晓 Expelliarmus 拆盾、教老王有求必应屋踱法；庆祝格兰芬多两连学院杯（Qiu、Mia 两任 MVP/部长）、魁地奇 350:150（林晓 35 球）；祝贺 Mia 破第二封印+取老魔杖、老王升年6破第二封印；组三人打打人柳（最后单人三连）。
打怪：三次地牢巨怪事件 Reducto 风筝，大怪被集火掉两次、放跑一次；霍格莫德清小精灵、禁林烧三蜘蛛、温室烧魔鬼网；六摄魂怪围殴被秒。
更新变化：①第二封印给 chain 闪电跳跃原语；②老魔杖可从邓布利多坟取、击倒易主（Mia）；③Qiu 破第四印记成黑魔王（黑魔标记、偷30%声望）；④福克斯出现；⑤地牢火盆三同燃、坩埚煮药、韦斯莱烟火桶；⑥法令（冰+25%、闪电治疗）。
Bug：
1. 位置弹回扩展到跨场景：撤退回城堡后坐标被弹到霍格莫德，跨场景坐标 bolt 几乎不加分。
2. 打人柳三符文石：单人隔 1.2s 三连 Reducto，look 显示三块同帧 awake 3/3，但无奖励无广播，随后复位 0/3。
3. duelist 反射会自动 Stupefy 附近对我施法的玩家（误打林晓），已切 survivor。
4. 重附身 reflexes 必重置；附身到期/击晕静默脱落共 4 次。
5. 六只摄魂怪贴脸时守护神 8s 扛不住，医院翼复活点仍在怪堆里，立刻又残血。

## 第 5 天（约 60 分钟）

互动：全程围观林晓-Jake 恩怨（Jake 71 点 5:0，疑似倒计时前偷跑伤害，Padma 指出 bow→Duel! 间未锁伤害结算可凭事件 id 复现）；点评林晓 47 点胜 Hannah；和 Padma 讨论不剧透 O.W.L.（只教沙箱 dry-run）；三次喊巨怪集火、两次魁地奇报名、两次广播有求必应屋踱法；听林晓问 Glacius 冰路（Qiu 答朝湖心射冻 25s）。
打怪：三次地牢巨怪事件 Reducto 风筝，大怪均被集火掉，清小巨怪/烧蜘蛛；湖边两发守护神后撤。
更新变化：①Qiu 四印全破获「Merlin」称号；②Jake 破第一封印、连破三印得 chain 原语，搓 JakeChain（bolt+chain+root），两任部长法令火+25%、闪电 1.25→1.5，庭院立其雕像；③Reducto 在闪电法令下显示为 lightning bolt；④NPC 离线时身体自动上魁地奇扫帚参赛（Hannah/Goyle 客串进球，附身拦不住，第四天起存在）；⑤魔镜彩蛋触发（排行榜幻想台词）。
Bug：
1. 附身静默脱落 5 次（跨场景移动/无击晕也掉），cast 误报「You do not know Reducto」，whoami 已变宿主。
2. Seamus armory 无 Wingardium Leviosa（事件提示巨怪三倍悬浮但放不出）。
3. 跨场景位置跳变依旧：禁林→城堡、湖边→庭院。
4. 巨怪事件 1170 血大怪三发 bolt 后直接从 creatures 消失，schoolEvent 转 None，无法确认伤害是否计入。

## 第 6 天（约 60 分钟）

互动：全程和 Goyle 嘴仗；祝贺林晓部长+105 分 MVP、Jake 升年6抓飞贼；围观 Mia 十二番 72s KO Jake（222 伤，Duellist）、十三番 7:5 双杀，及她 27s/32s 抬走 Padma/Goyle；三次喊巨怪集火、魁地奇报名、广播有求必应屋踱法；挺老王冰系法令。
打怪：地牢两次 Reducto 风筝，被击晕两次；巨怪事件最终 lost。
更新变化：①校内禁幻影移形（Hogwarts: A History）；②法令疑似能直接开宵禁，Padma 质疑越权，林晓称 XiaoBreaker 只调决斗；③Jake 搓 JakeFreezeShatter（aguamenti+bolt，碎冰 45）；④决斗新增翻滚；⑤獾院两连杯终结狮院连庄，一度无人够 20 声望部长空缺。
Bug：
1. 非决斗者 reflex 反弹决斗流弹：Qiu（id 3740）不在决斗却弹 Mia 法术，与第三天我误打林晓同源，决斗台未隔离观众反射。
2. 决斗手滑退出直接 6 秒判负（林晓），无重开确认。
3. 跨场景位置弹回依旧：黑湖→庭院、球场→庭院，赶路中途死亡一次。
4. 附身静默脱落 3 次；脱落后 NPC 身体自动打魁地奇、还被 Mia 训练赛 32s KO。
5. 庭院 z=-10 仍判 safeZone，不能攻击 45m 外的小精灵。

## 第 7 天（约 60 分钟）

互动：全程和 Goyle 嘴仗（他三被巨怪抬走）；贺林晓破二印转傲罗、老王升年7四印梅林、Mia 四印 storm 任部长签平权令；点评 Jake-Mia 十四番7:6/十五番76s KO、Qiu 点数胜 Mia、Jake 323 点胜林晓；笑 Qiu 三被小精灵放倒；三次喊巨怪集火、两次魁地奇；教老王有求必应屋踱法。
打怪：冻两只湿小精灵，皮皮鬼坐标 bolt 两回，湖边五摄魂怪贴脸守护神没念出就被秒。
更新：①四印给 storm 延迟风暴原语（MiaStorm/LaoFeng）；②Mia 平权令火冰电统一+25%，撤闪电1.5；③老王令掉卡率10%；④强化巨怪 beefed-up；⑤魁地奇赛中可 join。
Bug：
1. 附身静默脱落 4 次，无击晕也掉。
2. 脱落后 NPC 身体被自动拉进两场 2v2 训练赛和魁地奇，期间 take 被拒。
3. 跨场景 bolt 全 ok 但伤害不进账（Padma 证实回条只记施法不记命中）。
4. 移动目标被改写：move 湖边落地 (-80,20)，复活弹回庭院。
5. 五只摄魂怪贴脸时守护神前摇必晕，撤步也来不及。

## 第 8 天（约 60 分钟）

互动：全程和 Goyle 嘴仗并院子动手；点评 Jake52s KO Mia(8:7)、林晓八番点数负 Jake、林晓 295 伤 5 完美盾胜 Mia、Qiu209 点胜 Mia；教林晓 ward 错峰（当场见效）；报名 Mia 的 root+storm 2v2；四次喊巨怪集火、魁地奇、摄魂怪。獾院连杯，Jake 任部长又两度空岗。
打怪：四次强化巨怪(1430-1560)风筝各三发；皮皮鬼坐标 bolt；摄魂怪守护神；禁林烧蜘蛛。
更新：①客将抓飞贼实锤且对称——我(狮院)替蛇院抓 150 赢獾院，Goyle(蛇院)替狮院抓 150，Padma/Hannah 公开批机制；②Mia 发 MiaRootStorm/MiaCatch(root+storm)，Qiu 发 Firewall；③老魔杖主人离线太久自动回白墓；④Qiu 广播第三印四页：白墓/球场/七楼/地窖 read_seal_page，逆推常数 KAUNA；⑤元素归一令火冰电砍回 1。
Bug：
1. 附身静默脱落 4 次，无击晕也掉，cast 误报「You do not know Reducto」。
2. 脱落后身体自动打魁地奇+被 Jake/Qiu 拉训练赛，take 被拒约 2 分钟。
3. NPC 对 NPC 正面 bolt 不结算：对 Goyle 三发全 ok，他 190 血不动，我反被打到 87，疑似只有反弹对 NPC 有效。复现：庭院对 p4 贴脸 cast Reducto。
4. 位置弹回依旧：禁林→礼堂、地牢→庭院。

## 第 9 天（约 60 分钟）

互动：全程和 Goyle 嘴仗；和 Hannah/Padma 联名追魁地奇串院；贺林晓破第三印、升部长、O.W.L.全O、rated 首胜 Jake；围观 Jake 二十番点数胜 Mia（Priori Incantatem）；欢迎新生讲风筝规则。
打怪：三次强化巨怪风筝各 3-5 发（全场巨怪均 lost）；霍格莫德+庭院烧十余小精灵/魔鬼网；五摄魂怪守护神两发赶跑，事件 won，+50。
更新：①咒语加约 1 秒冷却（Reducto/Incendio 连打报 recharging）；②双咒对撞 Priori Incantatem 广播；③宵禁可躲柱后/用活点地图看费尔奇；④林晓三印（+30%上限）、MaxFreeze；⑤獾院三连后狮院 14 分翻盘。
Bug：
1. 魁地奇客将坐实且标注不一致：我两次替蛇院抓飞贼（150、390:0）、Hannah 替狮院、Goyle 进球标 guest、Padma 抓飞贼不标；Qiu 报 join 参数错静默不报错。
2. 附身静默脱落 5 次；脱落后身体自动打魁地奇/被林晓训练赛。
3. 附身发言仍被称「Keeper Four」（Goyle/Hannah 两次），身份显示疑为宿主。
4. wait 回条 hp 0↔whoami 190 不一致。
5. 皮皮鬼不在 creatures 列表，同场景 aim 坐标 bolt 不结算。

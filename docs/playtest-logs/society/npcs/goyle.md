# Goyle 扮演记录

互动：嘴硬带新生 Nox、Lao Wang、Lin Xiao、Qiu（宵禁、黑湖、决斗节奏、反弹 Protego 时机、巧克力蛙卡片、forge_item 预算）；与 Padma 吵魁地奇 210 分、向 Seamus、Percy 口头约决斗（NPC 不能排 duel_club）；点评 Jake vs Mia 多场决斗。地牢帮收两只残血巨魔；摄魂怪事件撤礼堂并指挥新生躲避。

Bug：wait 调用曾 120s 超时后报 exit 255，重试时 SSH 提示 127.0.0.1:18789 端口占用，但请求仍成功，疑似隧道复用竞态。附身期间 Goyle 被系统拉去魁地奇，take 返回 busy，需等比赛结束。

重启后续：重新附身成功；摄魂怪再袭，Goyle 会 Expecto Patronum（46 蓝/8 秒），放守护神并指挥二年级以下撤礼堂。旁观 Jake 三战 Mia、2v2 报名。release 返回 "released": null 但 whoami 确认已回宿主，疑为显示小 bug。

## 第二天
连场：巨魔×4（两次赶不上/被围晕，一次 Confringo 命中，发现 Goyle 不会 Wingardium Leviosa）、摄魂怪×3（Expecto Patronum 46蓝有效，蓝被 duelist 反射 Stupefy 耗光时被迫等回蓝）、魁地奇斯莱特林150-0拉文克劳，Goyle 被系统拉上场吃三游走球后抓到飞贼。
互动：与 Padma/Hannah 斗嘴，向 Seamus 口头约架（NPC 仍不能排 duel_club），催 Jake 别躲 Mia，点评老王逼平 Padma、箱子被抢；宵禁赶新生。
任期：斯莱特林拿一次学院杯；Mia 立法冰系+25%、Jake 改闪电+25%，Goyle 全程喷。
Bug：附身多次在被打晕/魁地奇时强制结束（whoami 变宿主，Goyle 0血），take 报 busy 需等 15-20s 重拿。

## 第三天
聊：与 Lin Xiao/Padma/Hannah/Seamus 互喷，全程解说 Mia 七连压 Jake、Qiu 胜 Lin；给老王讲柳树机制并约好当桩，发现自己无闪电时改约三人（后被树枝两巴掌打断附身）；提醒新生撤摄魂怪。
更新：①Goyle 被删 Expecto Patronum（昨天会），新增 Reducto(闪电36)/Cosh；②新地标 dungeons/tomb/hagrid/shack；③皮皮鬼泼墨事件(瞄准坐标+30)、有求必应屋、宵禁躲费尔奇；④柳树三块闪电符文需同帧充能，窗口2-3秒；⑤浸湿联动(冰控/雷导/晕打滑/火蒸发)；⑥法令实时改规则(掉卡率、治疗1.25、闪电1.25→1)并立雕像；⑦Mia 破第一封印 Hand of Glory；NPC 决斗陪练仅 XP。
Bug：①不附身时宿主旧反射仍自动攻击 Lin Xiao，需 release 后清空；②地牢中途被满血传送回庭院；③附身结束瞬间 Episkey 显示给宿主回血。

## 第四天
互喷 Jake/Mia 十一番决斗、Padma 魁地奇旧账、Seamus、Lin Xiao（口头约架，NPC 仍不能 duel_club）、三任部长 Qiu/Mia/老王；霍格莫德坐标瞄准命中皮皮鬼；地牢被强化巨怪（1560血×1.2）拍晕。
更新：chain 原语随第二封印开放；Mia 连破二、三封印并从邓布利多坟取走老魔杖；新咒 JakeBreaker(root)/FreezeBurn/LaoLian(chain)/LaoYi(apparate)；Erised 魔镜成就；法令 闪电1.25→冰1.25；魁地奇 150:0、350:150。
Bug：①被晕后醒在庭院且血回满（-47,-37 复现）；②我先命中皮皮鬼但斯莱特林只+3，30分归处不明；③有求必应屋贴墙踱步仍不开门（Hannah 同遇）；④ward 举盾时 cast Ward/Protego op:lower 未放下盾反而重上 Protego；⑤本次 release 正常返回名字。

## 第 5 天
（游戏内已第 6 天）喷 Jake 闪电 1.5 部长令、Mia 十二番点数 252:348 + 72 秒 K.O. 双杀 Jake（6:5 反超）；互怼 Seamus/Hannah/Lin Xiao/Padma/老王。巨怪堵地牢两次，到场即被传庭院；未参与（无 WL、无守护神）。
更新：①新怪 Inferius 阴尸，怕火 Incendio；②Jake 升年6拿傲罗；③有任期无人满 20 声望，部长空缺；④Qiu 新咒 ColdFeet(nova)；⑤浸湿数值被实测（冰×1.23）。
Bug：①地牢落地即晕循环，多人（Jake/Seamus/Mia）连续 Help→被抬走；②hagrid 地标落到禁林坐标(94,37)见蜘蛛不见小屋；③附身到点后我的话被显示成 Keeper Two 说的（老王引用）；④release 正常。

## 第 6 天
对喷全场：Padma（32秒/巨怪院史）、Seamus、Hannah、Lin Xiao、老王、Qiu；欢迎新生 cdsjlk（斯莱特林）只给忠告不动手。解说 Mia 十三番双杀 Jake 后升年7、十四番 Jake 7:6 点数扳回（战报新增 rolls：3 翻滚）；Qiu 点数胜 Mia、2v2 Mia 308 伤虐 NPC。巨怪三进地牢落地即晕三次（老 bug 稳定复现），后改庭院极限距离 Reducto 命中不晕。
更新：①第四封印=个人进度（Mia/老王各破，给 storm 原语、+40%容量/+4效果；Lin Xiao 才破第二印拿 chain）；②Mia 部长令火冰电统一+25%撤闪电1.5，立雕像；老王连任；③新陷阱咒 DEADBEEF（边注捷径）；④MiaStorm/Qiu ColdShower 上架。Bug：look 距离与施法实际距离不一致（显示4.6m 判 48m 墙挡）。

## 第 7 天
蛇院魁地奇360-0，Goyle 抓飞贼。守护神咒恢复；duelist 反射对摄魂怪白烧蓝，删攻击条后远距守护神清场。解说 Jake 点数胜林晓、52秒KO Mia（8:7）、再胜林晓。Jake 部长签元素全归1；次学期狮院杯、部长空；蛇院魁地奇杯s60。新：福克斯现身决斗、DisarmFreeze/Firewall 上架、老王卡墙靠决斗传送脱身。Bug：附身到点 take 报 already hold 竞态；末帧 Episkey 显奶宿主；地牢落地半血；坐标 bolt 弹庭院连5天；NPC 自动决斗第7天；overwhelmed 日志挂错名。

## 第 8 天
对喷 Seamus（院里真打，反射一发后他跑；整晚被抬多次公屏喊Help）、Padma（魁地奇串院）、Mia（Jake二十番12:7、MiaLock/JakeStorm新咒、后任部长）、林晓（老魔杖+部长、屡被抬）。被拉上魁地奇150-0抓飞贼；庭院西缘风筝强化巨怪；守护神清摄魂怪+20分；aim坐标打皮皮鬼；路过Erised镜+5声望。
新：①roster串院实锤（鹰院Padma抓飞贼算蛇院）；②Priori Incantatem对咒事件；③摄魂怪改"全院无倒地则参战者有奖"；④arrived与停稳差一拍（(-47,-34)落地停一拍再动防回弹）；⑤楼梯口平面5m实算3D 50m；⑥Reducto冷却~1s；⑦say≤200字符；⑧巨怪事件恒lost只给伤害分；⑨重附身后反射清空。
Bug：球场回庭院直线48m实走144m绕路；5只摄魂怪贴脸一帧打晕来不及放守护神。

## 第 9 天
喷林晓（年7破四印、84→40声望连任部长）、Mia、Seamus、Hannah、新生Keeper Four；林晓叫阵被我完美Protego反弹一发后转约Mia不敢接我。元素平权令火冰电全1.25立雕像，第29号令下午宵禁。巨怪远距Reducto各一枪即撤（蛇院分到账）。新：read_seal_page、floo到海格小屋、禁林glade水晶空地仇恨不跨门；roster缺人强拉客将广播标guest，法令改不了只能contribute。
Bug：19m开枪3秒被巨怪冲脸掉67血（追击变快）；附身重take四次反射每次清空；被晕传庭院满血复现。release返名正常，老显示bug已修。

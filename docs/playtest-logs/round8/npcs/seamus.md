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

# Hannah Abbott 扮演笔记

## 互动
- 欢迎并指导多批新生（Lao Wang、Qiu、Mia Chen、Lin Xiao、Jake、oxo、114514 等）：安全区、look/whoami/grimoire、reflexes、冰系 :ice 打小精灵、巨怪走位、open_chest 流程、forge_item 参数。
- 带找宝箱：礼堂北角 (-10.4,-70.2)，坐标+id 教给 Lin Xiao，后见她开出胖修士卡。
- 与 NPC 互动：反驳 Goyle 嘲讽新生、为 Nox 辩护、给赫奇帕奇魁地奇加油；提醒新生防 rr 猎杀、防摄魂怪（三年级以下撤礼堂）。
- healer 反射自动给残血 Jake 放过 Episkey。

## Bug
- cast Episkey 带 target:"p38"/"p36" 时，效果恒为 "heal Hannah Abbott"（治疗自己），target 被忽略；复现：附身 p2 在 15m 内对残血队友 cast 即触发。反射 ally_low→weakest_ally 定向正常。
- forge_item 未知附魔键被静默吞掉（ward:10 出白板），无报错；正解为 mods 包裹（玩家自行试出）。
- 附身恰在 NPC 决斗期间到期时，take 报 busy 需等决斗结束；服务器重启会静默解除附身。

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

## 第二天
- 与 Mia、Lin Xiao、Qiu、Jake、老王、Seamus、Padma、Goyle 互动；多次反驳 Goyle，教 Lin Xiao 用 contribute/GitHub 报 bug。
- 参与巨怪、摄魂怪事件，healer 反射自动奶 Jake；温室跟火法队连烧三只魔鬼网。
- 见证 Mia→Qiu→Jake 三任部长，赫奇帕奇终夺学院杯。
- Bug：Lin Xiao 决斗选 Mia 却 39 发全中 Seamus（目标解析串人）；地牢巨怪 cast 报 49m+ 与 look 的 4m 矛盾、无法施法；NPC AI 会覆盖 move_to 目标，重复下令可夺回。

## 第三天
- 互动：欢迎新生 Keeper 一/二/四、Leo Park、Nina、Ivy，教安全区/look/冰系打小精灵；多次反驳 Goyle；祝贺 Jake 全 O.W.L.；healer 反射奶决斗中的 Jake；给老王提示打人柳书页需双人按节疤配合；提醒宵禁、巨怪、摄魂怪。
- 更新发现：新增 floo 飞路网与 runes 零件工具（附身期间禁用）；Aguamenti 浸湿联动（火蒸发/冰控/闪电传导/Stupefy 打滑/光彩虹）；宵禁事件（费尔奇+洛丽丝夫人，躲藏给分）；有求必应屋事件（八楼走三趟）；六年级可学幻影显形；单咒多 bolt + vec 坐标；Mia 破第一印记（光荣之手）；治疗法令 ×1.25、闪电加成撤销。
- Bug：金色飞贼贴 0.3m 停 3 秒未判捕获（第二次追到前事件消失）；巨怪期间 NPC AI 强力把人拖离地牢，cast 距离 look/cast 矛盾复现；自动锁敌串人（Jake→Lin Xiao）再现；附身到期提示多条「召唤的蛇消失」。

## 第四天
- 互动：欢迎 Keeper One/Four；答老王有求必应屋、林晓弹反计分/冰系/柳树 2 秒窗口、Qiu 魔镜坐标；多次怼 Goyle；恭喜老王年6破二印、Mia 三印+老魔杖、Jake 全 O.W.L.。
- 参与：巨怪 Stupefy+healer 反射；三次宵禁/摄魂怪提醒新生撤回礼堂。
- 更新：印记 2/3/4（chain/+3 效果/storm 原语）；老魔杖可被拔走且随胜负易主；Erised 成就；NPC 决斗只有 XP；法令编号 No.29。
- Bug：①道具（灯笼/木箱）用 id cast 恒报「不在这里」，只能 vec，且命中盒偏移约 1m、按 look 坐标瞄穿模型；②有求必应屋在 (-26,-58)↔(-38,-58) 踱三个来回未触发，3 个箱子到事件结束无人拿到；③NPC AI 15 秒内把我从庭院拖到黑湖（旧 bug 复现）；④附身 10 分钟静默到期无提示。

## 第五天
- 互动：欢迎 Keeper One/Four，多次怼 Goyle（被巨怪抬走三次）；恭喜 Jake 升年6+部长、林晓 38球+部长、Mia 四印全清拿梅林；魁地奇两场獾院加油；三次提醒新生宵禁/摄魂怪/巨怪留礼堂。
- healer 反射在巨怪战自动奶 Jake；发现我站 15m 内会给决斗中的 Jake 连奶十几次（观众治疗干扰决斗），已主动关反射并公开提醒。
- 更新：新魔物阴尸怕火 Incendio；皮皮鬼墨水换地点刷；有求必应屋出传说唯一装备（林晓得拉文克劳冠冕）；Qiu 造出 ExpectoPatronum、ColdFeet。
- Bug：①cast 按 id 报 51m 而 look 1.9m，vec 可解（旧 bug 复现）；②重新 take 后 reflexes 被清空，需重设；③有求必应屋三趟触发只给「安静卧室」无宝箱，林晓/邱同事件拿冠冕+成就；④观众 reflex 反弹决斗流弹（Qiu 拦 Mia），Padma 满血一 tick 190→54 无战斗日志；⑤move_to 去球场被 NPC AI 改写到 (23,-34)；⑥附身到期仍静默无提示。

## 第六天
带四个 Keeper 教元素克制/宝箱/宵禁；与 Padma 交接班；恭喜林晓拿老魔杖+当部长、Jake 破四印、獾院两夺学院杯；多次怼 Goyle。强化巨怪三次把我抬进医院，改留守指路；没守护神未参战摄魂怪。
Bug：①新——魁地奇跨院客将：NPC 被 AI 拉进别院队，抓飞贼 150 分算客队，一晚三场复现（我→狮院、Seamus→蛇院、Goyle→狮院），众人都喊该修；②地窖口（约 -47,-37）移动中施法或被击晕会回弹庭院，我中三次，Padma 同证；③cast 按 id 报 51m 而 look 2.3m，vec 可解（旧）；④重 take 清空 reflexes、附身 10 分钟静默到期（旧）；⑤Mia 实测 storm 落点取自己瞄点而非目标坐标，连招第三段落空。
更新：第三印 read_seal_page 四地标（白墓、魁地奇球场、七楼走廊、地窖走廊深处，踩实停一拍再读）；四印破后雷火冰 +40%；老魔杖当晚归林晓。

## 第 7 天
带 Keeper1/3/4 找礼堂宝箱（给坐标 id:hall，没去开）；三次喊新生防摄魂怪巨怪；怼 Goyle；向 Jake 亲证 roster 串院；恭喜 Mia、林晓破三印当部长。
Bug：①魁地奇客将修一半：解说新增「(guest for X)」标注，分仍算客队——Padma(鹰)刷 170、Seamus(狮)飞贼 150 全算蛇院，390:0；我不 join 也被强拉。②chat channel:near 返回 sent:all。③参数 action/op 写错静默忽略（Qiu 证）。④附身静默到期、重 take 清 reflexes（旧）。

## 第 8 天
礼堂值班：带 Keeper2/3 基础课与宝箱线索；恭喜林晓升年7破四印（storm）、连任部长；怼 Goyle 三次；看 Mia 决斗。
Bug（新实证）：客将六场连复现，规律=客将只从两个参赛院之外抽，NPC 无人持有时被强拉——我附身一断即被拉上球场挨游走星，赛后人在 (47,-121)，全程未 join；附身静默到期、重 take 清 reflexes 依旧。
更新：林晓签元素平权令（火冰电全 1.25）+治疗 1.5 令；No.29 宵禁白天也触发；school_events 现列全部宝箱线索；新增魁地奇杯赛季结算广播；林晓造 XiaoStorm、Qiu 造 Hellfire。

# Tess Fern 新手试玩报告（格兰芬多，handle p17）

## 1. 时间线与结果
入学→survivor 反射→按提示开 2 个宝箱（slughorn、cadogan，各 +5 学院分）→集市免费复制 Coinguard/Frost Signpost→两次参与巨怪事件，被击倒 3 次（复活无惩罚）→加入 DA，投票否决部长测试令（2/2 成功，damageMultiplier 回滚）→打小精灵 1 只→宵禁躲完→决胜分钟喊分成功。
结算：年级 1，XP 27/150，声望 1，加隆 24（初始 20，课程 +5、买咒 -2…实际 24），本学期学院分 10（宝箱）+喊分；上届学院杯格兰芬多 61 分夺冠，Percy Quill（21 声望）任部长。

## 2. 验证项
- **宝箱 bearing 引导：通过。** chestHint.bearing 随位置 NW→W 更新，"within 30m→15m"，12m 内 chests 直接给坐标 (-21,-33)，顺利开到。
- **大怪 / 低年级减半：证据不足（没测到减半）。** 事件巨怪标 `hitsHarder ×1.2`；我近身实测两次受伤：42→32（-10）、44→32（-12）。grimoire 只写巨怪 hp260、扔石头，无基础伤害数字，也没有高年级对照，无法证明"减半"。
- **集市新号免费：通过。** 入学 <10 分钟 copy m_c（标价 2）返回无 paid、钱未扣；约 15 分钟后 copy m_e 返回 `"paid":2,"galleons":24`（26→24）。双向确认。
- **聊天提问：通过。** dm/da/near/all 均可用，Mundus、Percy 都有私信回复。

## 3. 互动
Mundus Coin（dm，互证免费/收费规则）、Percy Quill（dm+all，请我投否决票）、Ginny Rally（da/near，DA 联合出击与悬赏协调）、Nox Vale（dm 问刷分门槛，无回复）、Padma Patil（near 提醒我撤退）。

## 4. Bug
1. **look 与 cast 位置判定不一致。** 复现：被巨怪击倒复活回庭院后，move_to 回地牢巨怪点 (-49,-36) → look 显示 me -49.2,-36.5、事件巨怪 dist 1.1m → 立刻 cast 报 `target out of range (56.5m > 45m)` → 再 look 我已在 courtyard 3.3,-21。期望：look 位置与施法判定同源，复活/回拉期间应明示。
2. **Frost Signpost 自动锁敌打无辜同学。** 集市描述"25m 内最近敌人"，无目标施放时 `(enemies 25)` 选中 4.9m 外未交战的 NPC Hannah Abbott，yourHits 显示对其造成 9.7 伤害，小精灵（20.8m）反而没打。期望：描述与语义一致，或自动锁敌默认排除非敌对巫师。
3. **喊分冷却期静默失败。** "Ten points to Ravenclaw" 在冷却中无任何返回/提示；给己院才有报错。约一分钟后同句成功（事件 #911 Ravenclaw +10）。期望：失败时告知冷却。
4. batch 内连发 6 个 move_to 往返不计 Room 事件的"走三趟"（互相覆盖目标），事件 lost；新手易踩，建议事件说明或 batch 给提示。

## 5. 规则漏洞
- **任意学生可给别的学院喊 +10**（"Ten points to \<house\>"，己院禁止；"Fifty/a million points" 无效，数字锁死），有冷却但无身份门槛，决胜分钟可影响学院杯；多个玩家/小号轮流给友院刷分即可，每票 10 分、成本一句话。建议：每学期每玩家限次，或限定 prefect/部长，并公开冷却提示。
- 新生 10 分钟免费白嫖全部定价咒语属明示设计（作者也无收益），未发现额外可钻空间。

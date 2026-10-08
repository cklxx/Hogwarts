# DA 组织者试玩报告（Ginny Rally, p14）

## 1. 时间线与结果
- 起步：year 2，XP 158，声望 0，加隆 66，HP 115。结束：**year 3，XP 438，声望 6，加隆 102，HP 130**，称号巫师。
- T90：两次巨怪事件把联合窗口推到 2/3，第三人均未在 20 秒内出手，窗口过期。期末格兰芬多 166 分夺杯，我以 75 分当 MVP。
- T91/92：Percy 当部长后颁布测试令 `damageMultiplier 1→1.5`；Tess 先投（1/2），我投第二票（2/2），**否决成功**，规则回到 1，法令标 `"vetoed":true`。
- T92/93：Mundus 主动开怪 c21tg4l，我在 47 米外施法（未命中，见 Bug 2）；两次冲事件巨怪被秒；Nox 中途加入 DA。联合一击全程未触发，`jointBadge: 0`。宵禁熬过 +50 学院分。

## 2. 验证项
- **联合一击 ×1.25：没测成**。`joint.now` 追踪正常（显示 target/id/members/secondsLeft，最高 2/3），但始终差 1 人，未见到 ×1.25 伤害或徽章。
- **联合私信：没测到**（未触发，无私信可看）。
- **否决投票：通过**。`veto_decree → {"vetoed":true,"votes":2,"needed":2}`；rulebook 中 damageMultiplier 回到 1，decree 记 `"vetoed": true`，DA 状态 `usedThisTerm:true`。投票有私信广播（"🗳 Tess Fern voted... 1/2"），但**否决成功本身无独立公告/私信**。
- 当部长自动退出 DA（"their name vanishes from Dumbledore's Army's parchment"），不能投自己法令的否决，符合设计。

## 3. 互动
- da 频道：6 次以上召集、锁目标、倒数。DM：Percy（约定测试法令+否决，成功）、Tess（首票+承诺配合）、Mundus（主动开怪一次）、Nox（受邀后加入 DA）、Viktor/Pip/aaa/龙傲天/ddddd（无回应）。all/near：招新与悬赏。反射自动击晕先手攻击我的新生 rr。

## 4. Bug
1. **wait(until:"arrived") 提前返回**：move_to 远点后立刻 wait，返回 `reason:"arrived"` + "You were not walking"，坐标仍是旧点；数秒后 look 发现实际已到目的地。复现 3 次。期望：到达后才返回。后果：自动化会在半路施法。
2. **超距施法静默吞蓝**：对约 47 米外的 c21tg4l cast 返回 ok、耗 16 法力、列了 bolt，但 `yourHits` 空、joint 计数不增，无任何提示；而超出视野的目标则硬报错且不耗蓝。期望：统一为报错或明示未命中/退还。
3. **joint 窗口跨学期残留**：学期切换后 `joint.now` 出现 `{"target":"?","members":2,"need":3}`，目标已不可解析。期望：学期末清空。
4. **set_goal_note 错参静默**：传 `note` 返回 `{"goal":null}` 不报错；正确参数是 `goal`。期望：未知参数校验失败。

## 5. 规则漏洞
1. **"Ten points to \<学院\>!" 任何人可给任意学院反复加分**：证据——格兰芬多的 Tess 喊 "Ten points to Ravenclaw!" → "Ravenclaw +10"；Percy 连续喊约 5 次每次 +10，无冷却、不限于本学院、未见计入发言者 400 分上限。收益：单人可持续操纵学院杯。3 步：开口、重复、决胜时刻翻倍刷。建议：仅限本学院或部长/级长，加冷却，并计入发言者学期上限。
2. **否决权可被小号低成本捕获**：入会门槛仅"声望<100 或低于中位数"，学期初几乎所有新号可入；否决只要在场 3 人中多数（我这轮在线 3 人、2 票即过）。3 个新号（<10 分钟还受保护）入会即可否掉部长每学期唯一的法令，部长毫无对冲。建议：否决票要求入会满 N 分钟/账号时长，或 quorum 随 DA 规模提高。

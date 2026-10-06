# 决斗者试玩报告 — Viktor Brand（二年级 Gryffindor）

## 1. 做了什么 / 结果
专测决斗俱乐部。时间线：单人排队→NPC 补位开打（连输，自动 dodge 滚进安全区）；学期末意外当选魔法部长（声望 25）；赢真人 Mundus Coin（+6 声望）；两胜 Nox Vale（无奖励）；补测 bow/count 阶段取消；测定向约战与非法参数。

数字：声望 3→学期末 25（当部长）→衰减 12→赢 Mundus 18→衰减 **15**（本届 +6）；年级 2，XP 164→**283**；加隆 32→**39**；学院分 Gryffindor **11**；winsThisTerm **1**。

## 2. 验证项
- **NPC 约 30s 补位且还手：通过。** 首排约 32s 进来 Seamus Finnigan，私信 id33；id40/49 "Your ward met Seamus Finnigan's spell with a perfect Protego"，确有出咒。NPC 为七年级 190 血，对二年级偏强。
- **匹配收到私信：通过。** id33/149/594，kind=duel 私信 "Your Duelling Club match is on"。
- **鞠躬/倒数离开只算取消：通过。** bow 与 count 两阶段 leave 均返回 `left:"cancelled"`，"no result, no reward, no rematch wait"。
- **打斗中进安全区算出局：通过。** id54/233 "You stepped into a safe zone… you are out"，判对方胜。
- **定向约战 with：通过。** `join with:"Mundus Coin"`→对方收挑战私信 id592→其接受后真人匹配，无 NPC，90s 我胜。
- 附带：指名 NPC 被拒 "NPCs take no challenges"；不存在名字被拒 "There is no wizard called"。

## 3. 互动
Mundus Coin（dm 推销咒语 m_c/m_k；定向约战并打完，我胜）；Ginny Rally（da/dm 多次邀 DA 联合 ×1.25 打巨怪/Devil's Snare，因决斗未参加）；Percy Quill（dm 祝贺当选、问 decree，未回）；Nox Vale（两度决斗对手，我胜）。NPC Seamus/Padma 陪练。当选部长后被 DA 自动除名（id254）。

## 4. Bug
1. **duelist 预设反射在决斗台自毙（高）。** 复现：`reflexes {"preset":"duelist"}`→排队→fight 中不操作；其 incoming→dodge 规则无方向意识，连滚几次把人送出 22m 舞台/滚进 Great Hall 安全区，收到 "stepped into a safe zone… out" 直接判负（我连吃 secs 11/9 等）。系统推荐给决斗的预设在决斗场景必触发。期望：决斗中 dodge 朝圆心限位，或台边给缓冲。
2. **phase 名与文档不符（低）。** 文档/私信写 "countdown"，`match.phase` 实为 `"count"`（另含 `"bow"`）。按文档监听 countdown 永远等不到。
3. **开赛窗口 2–3s，取消竞态（中）。** bow 仅剩 2s，先 status 再 leave 两次往返间已滑入 fight，返回 `forfeit` 并给对方记胜（Padma secs4）。文档承诺"鞠躬离开算取消"，常规往返节奏难达成。建议拉长窗口或 leave 支持携带预期阶段做原子判定。
4. **补位不固定 30s 且无提示（低）。** same-pair 10 分钟冷却后，单人排队实测等约 56–64s 才补位且更换 NPC（Padma），干等无任何提示。

## 5. 规则漏洞
- **开赛前取消零成本可骚扰。** `join with X`→对方接受被传上台→我在 5s 内 leave，`cancelled` 不计胜负、不占重赛冷却，可立刻重复，把对方反复白叫上台而自己无惩罚。收益 0 但骚扰无限、0 步成本。建议挑战方取消计入频率限制或短冷却。（机制确认，未对真人端到端跑。）
- **赢低一年级玩家未给奖励，触发条件文档缺失。** 两胜一年级 Nox（差 1 年，非 3+），winsThisTerm 恒为 1、无声望；两场对手 dealt 均为 0。可能实现要求"对方有效还手(fought for)"，但文档只写 3 年级差。建议补明规则。

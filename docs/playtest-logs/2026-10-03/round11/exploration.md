# 第 11 轮：探索工具真实 MCP 回归

本轮 before 为 main 4c59861，服务器 http://127.0.0.1:7777/mcp，沿用 ExplorerAsh。未改状态、时钟或存档。

## Before

1. 庭院位置(0.4,-33.6)，look radius10 返回11个props，其中10个超过10m，最远23.25m。原返回保存在[before-courtyard.json](exploration/before-courtyard.json)。
2. 正常走到庭院飞路(11.8,-12.4)，floo lake后位于(-82,26)。look radius12 返回31个props，其中16个超过12m，最远25.0m。原返回保存在[before-lake12.json](exploration/before-lake12.json)。
3. 在黑湖飞路(-82,26) move_to landmark:hagrid，返回walkingTo:Hagrid's Hut、distance15、etaSeconds2，未说明是当前段、未给出当前段终点或最终目的坐标。紧接wait等待实际跨场景到达（下文补充结果）。

Before跨场景结果：紧跟move_to的wait实际waited17.9s、arrived，最终(94.7,37) / The Forbidden Forest，HP115保持，事件明确穿过城堡与禁林两次场景。显示的eta2秒是首段估计，不是全程。

## 固定查询负载对照（非 FPS）

通过实际 World.look 查询，固定 seed43、角色 Query Reader、黑湖飞路(-82,26)，计数props段与其无空白JSON UTF-8字节；未开启世界tick，属性状态固定。before/after分别保存[before 查询夹具](bench/props-query-before.jsonl)和[after 查询夹具](bench/props-query-after.jsonl)。

| radius | props数 before→after | 最远距离 before→after | props JSON字节 before→after |
|---|---|---|---|
| 10 | 31→13 | 25→9.847m | 5671→2159（-61.9%） |
| 12 | 31→15 | 25→11.621m | 5671→2605（-54.1%） |
| 40 | 31→31 | 25→25m | 5671→5671 |
| 80 | 31→31 | 25→25m | 5671→5671 |

这是返回信息范围和查询负载的对照，不是帧率或服务端延迟基准。默认与大radius的25m物件上限保持原状。

## After：远程实现 8798750 的真实 MCP 回归

实测本地整合提交为 `ae8f3df`，其代码树与远程实现提交 `8798750` 相同。

服务器由主 Agent 安全重启后，沿用 ExplorerAsh。所有移动均为 move_to / floo，无状态、时钟或存档修改。

1. 从保存的禁林位置正常走到海格飞路，经 floo courtyard 回庭院，合法 move_to(0.4,-33.6)，实际停在(0.6,-33.3)。look radius10 返回1个props（水盆），0个越界，最大距离3.354m；before相近点为11个props且10个越界。
2. 正常走到庭院飞路后 floo lake，精确落在(-82,26)。look radius10 返回13个props，0个越界，最大距离9.847m，与固定seed查询验证一致。
3. 第一次随后查询radius12前，角色自然被夜间怪击倒并复活，结果you已经在庭院；该结果不计作黑湖回归。重新合法走到庭院飞路、floo lake后立即查询radius12，确认you=(-82,26)，返回15个props，0个越界，最大距离11.621m。before同坐标为31个props、16个越界、最大25m。
4. 黑湖(-82,26) move_to landmark:hagrid仍保留walkingTo:Hagrid's Hut、distance15、etaSeconds2；新增route.currentTarget=(-76,12)、route.destination=(95,34)、continues:true、estimateScope:current_segment、estimateBasis:straight_line_at_base_speed，以及中英说明：当前段而非全程，排除绕路、扫帚、暂停等影响，建筑终点可能调整。
5. 紧接wait until arrived seconds30，实际waited18.1s后arrived，位置(94.7,37)/The Forbidden Forest，walking:false、state:in the world、HP109→115；事件确认先穿过城堡再到禁林。到达位置与before一致，导航行为保留，ETA口径现在清楚。

After原始安全文件：

- [after-courtyard.json](exploration/after-courtyard.json)
- [after-lake10.json](exploration/after-lake10.json)
- [after-lake12.json](exploration/after-lake12.json)（黑湖有效结果）
- [after-route.json](exploration/after-route.json)
- [after-arrival.json](exploration/after-arrival.json)

自然击倒后已回到庭院的那次 radius12 查询未选入本归档，不作为黑湖半径对照；上文保留这一实际干扰及重新抵达后的验证过程。以上结果均不含密钥。结论：3项半径现场检查与跨场景反馈/到达回归通过；这是Agent真实文字端交互，不代表真人趣味评分或浏览器帧率。

归档说明：选入两个 before 半径原始响应和五个有效 after 响应；before 导航与到达保留试玩者原报告文字记录，没有补造未保存的原始 JSON。固定 World 字节测量的独立边界与重跑方法见 [查询夹具](query-fixture.md)。

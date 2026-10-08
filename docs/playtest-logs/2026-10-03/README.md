# 第 10 轮验证证据（2026-10-03）

主报告见 [PLAYTEST](../../PLAYTEST.md) 与 [PERF](../../PERF.md)。

- [手机实玩](phone.md)：首轮20次、第二轮18次、长名字第三轮3次操作。
- [桌面实玩](desktop.md)：首轮24+次、第二轮14次页面操作及2次只读布局测量。
- [MCP探索](explorer.md)：首轮约65次，另有白天冰路及自然夜冰旧卡点回归。
- [性能原始数据和复现](perf/README.md)：CPU采样、动态浏览器、同快照静态浏览器；冻结世界只用于独立性能基准。
- [测试](tests.log)、[构建](build.log)、[形式化验证](formal.log)；类型检查退出0。最终修改之后只新增手机姓名卡CSS约束及证据文档，已重做类型检查、构建与真实手机回归。
- [姓名卡九组布局夹具](identity-layout.json)、[真实页面时间按钮](phone-clock.json)。

## 实际浏览器前后截图

| 场景 | 修改前 | 修改后 |
|---|---|---|
| 手机首次符文卡 | [before](screenshots/phone-rune-before.png) | [after](screenshots/phone-rune-after.png) |
| 手机时间可读性 | [before](screenshots/phone-clock-before.png) | [长名字 after](screenshots/phone-clock-after.png) |
| 窄桌面符文卡/引导 | [before](screenshots/desktop-rune-before.png) | [展开后 after](screenshots/desktop-rune-after.png) |
| 跳过配对继续旅行 | 首轮未进入8/8，见手机报告 | [after](screenshots/phone-travel-after.png) |
| 扫帚拒绝提示 | 原文字见桌面报告 | [after](screenshots/desktop-broom-after.png) |

截图来自真实游戏，但场景、角色和时刻不同，不能据此推断性能。未发布任何带配对码或密钥的图片。报告中的其余 `/tmp` 路径是本次工作区的原始记录定位，仅此表选取的图片随仓库保存。

这是 Agent 可用性验证；不提供真人趣味评分、SUS 或硬件 FPS。仍未修的问题已列入 TODO，未把它们记成通过。

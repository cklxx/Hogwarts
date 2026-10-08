# MCP 导航反馈真实回归

日期：2026-10-03。服务器：http://127.0.0.1:7777/mcp，主 Agent 安全重启后的新 MCP 版本。沿用第一轮真实入学的 ExplorerAsh，以 scripts/playtest/mcp.ts 调用；没有修改角色状态、血量、时钟或存档，没有打印密钥。以下均为真实工具返回，不是单元测试模拟。

## 1. 无当前行走：idle

调用 `wait {until:"arrived",seconds:2}`。

返回：`waited:0, reason:"idle", walking:false, state:"in the world"`，位置 `(3.6,-20)` / The Courtyard，HP115→115。note 为「当前没有行走，可能已在本次等待前结束；用 look 确认位置。」不再虚称抵达，也不再指责玩家未发起 move_to。

## 2. 正常抵达：arrived

先 `move_to {landmark:"great_hall"}`，返回 distance32/etaSeconds5；收到接受结果后立即发 `wait {until:"arrived",seconds:15}`，保证还在行走时开始等待。

返回：`waited:3.8, reason:"arrived", moved:25.2, walking:false, state:"in the world"`，位置 `(0,-51.6)` / The Great Hall，HP115→115。私有事件包含首次发现礼堂 +5 XP。正常到达语义保留，安全目的地位置正确。

## 3. 等待中合法停止：interrupted

在礼堂 `move_to {landmark:"courtyard"}`，返回 distance34/etaSeconds5。然后发起 `wait {until:"arrived",seconds:15}`；该 CLI 请求仍在执行时，在另一 MCP 会话用同一角色调用 `stop {}`，返回 `stopped:true`。两者都是合法游戏工具操作。

原 wait 随后返回：`waited:1.6, reason:"interrupted", moved:10.9, walking:false, state:"in the world"`，位置 `(0,-33.4)`，尚未抵达本次庭院目标（landmark工具目标z=-18）。HP115→115。note 为「行走在到达目标前中断；请检查位置和状态后再决定路线。」

结论：本轮真实 MCP 回归 3/3 通过：idle、正常 arrived、并发 stop 的 interrupted 均符合新合同。没有刻意触发击倒；KO、调整后的建筑终点、跨场景尾段未采样等边界由此前 9 个确定性 MCP+World 测试覆盖。本轮无浏览器测试，未对 UI 或真人趣味评分。

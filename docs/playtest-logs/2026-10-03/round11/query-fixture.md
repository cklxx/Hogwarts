# 第 11 轮：look.props 查询范围固定夹具

本文件记录固定 World 夹具的查询结果，**不是实际游玩、不是浏览器 FPS 或请求延迟测试**。归档输出由执行该测试的 Agent 提供；归档过程未重跑测试。远程实现提交：`8798750`（本地原实现 `8c61b33`，本地整合提交 `ae8f3df` 与远程实现代码树相同）。

- [可复现脚本](bench/props-query.mts)：`World` seed 43；新角色 Query Reader；测试直接设置角色坐标为 `(-82, 26)`。脚本中的 world secret 是固定测试常量，不是真实凭证。
- [改动前输出](bench/props-query-before.jsonl)、[改动后输出](bench/props-query-after.jsonl)。
- 可在目标版本仓库根目录运行 `npx tsx docs/playtest-logs/2026-10-03/round11/bench/props-query.mts .`。

| 请求半径（米） | before 条目 / 最大距离 / props JSON 字节 | after 条目 / 最大距离 / props JSON 字节 |
|---|---|---|
| 10 | 31 / 25 / 5671 | 13 / 9.85 / 2159 |
| 12 | 31 / 25 / 5671 | 15 / 11.62 / 2605 |
| 40 | 31 / 25 / 5671 | 31 / 25 / 5671 |
| 80 | 31 / 25 / 5671 | 31 / 25 / 5671 |

此夹具验证小半径查询返回的 props 遵守半径，且两组较大半径输出不变。字节数仅是 `look(...).props` 数组 JSON 的 UTF-8 大小，不代表整个响应大小，也不能推出 FPS、网络吞吐量或用户体验提升比例。

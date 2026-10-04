# 非倒地场景导航卡镜框：与倒地/复活路线独立

范围：只读 Newcomer actions.jsonl 和世界/地图/寻路代码；所有复现均为独立离线 World，没有登录/操作实际角色，没有修改仓库或服务器。

实游段：11:55:02.500，Newcomer 在 pitch(38.6,-134.3) 满血、非倒地、骑扫帚，move_to(great_hall) 返回合法跨场景路线，最终目的地 (0,-52)。11:55:05.507 已穿过迷雾到 castle(30.4,-63.1)，仍 walking=true；随后六个 wait(until=arrived,3s) 都 time，只有约 0.2 m 变化。11:55:25.992 stop 后重发路线，11:55:57.225 又是 15s time、walking=true，仅 0.2m。11:56 多个其他 move_to 仍卡在镜框后。

后续只读日志：11:56:58.986，玩家自己执行 dodge(dx=0,dz=1)；11:56:59.640 重发礼堂；11:57:07.296 arrived 于 (0.1,-51.4)。这是实际玩家解除卡住的操作，不是本复核代理执行。

## 最小确定性复现

`nav-first-leg-repro.ts/json`：World(seed=41)，关闭无关生物刷新/事件，在线一年级巫师直接放在 castle(30.017,-63.5)，没有 stun / broom / reflex / NPC，setGoal({x:0,z:-52},agent)，普通 20 Hz tick 25 s。

- 起点实际圆形碰撞可站立，但所在 2m 寻路网格单元 blocked。
- findPath 首节点固定 (31,-61)，`clearLine(start, first)` 为 false。
- 25s 后仍 goal=(0,-52)，位置 (30.507,-63.15)，HP100，stunnedUntil=0。
- 没有模拟跨区、击倒、技能或时钟变化，证明问题独立于复活路线。

`pitch-hall-nav-repro.ts/json` 保留完整实际触发：从 (38.6,-134.3) 移到 (0,-52)，骑扫帚/步行两种均复现。骑扫帚在 1.35s 穿区，步行 2.65s；都落在 (30.017,-63.5)，首节点 (31,-61)，之后始终振荡。30s 后 stop/reissue，再跑 15s，仍卡。两种最终相位分别约 (30.585,-63.15)/(30.415,-63.15)，和实游四舍五入到 (30.4,-63.1) 一致。

## 根因分两层

1. **首段没有检查通达性。** `edgeHop` 用球场朝北边缘出口；`edgeOut` 将目标点映射至城堡北边缘的 x≈30,z=-70。这个点在 East Wing box [13,62]×[-104,-64] 内。`cross` 的 Solids.resolve 把人往南推出到 z=-63.5；镜框恰在 x30,z=-62.5，宽2.4、深0.3。该位置身体能站，但 2m 网格中心 (31,-63) 的 0.7m clearance 与镜框相交而 blocked。`nearestOpen` 只按空间距离选 (31,-61)，不检查起点→候选节点这段被镜框挡住；findPath 随后无条件 prepend 这个点作为首段。
2. **侧滑振荡被当成进展。** moveWizard 到镜框背面 z=-63.15 后，朝目标的小幅横向运动与“撞墙侧滑”反复循环。`unstick` 用单 tick 位移长度/(speed*dt) 衡量 headway，不能区分朝目标或退步。每四 tick 的 x≈30.585→30.308→30.415→30.507→30.585 循环，都包含位移0.277m的退步；headway≈0.792 >0.3，令 stuck.t=0。后续0.107m位移也达到0.306 >0.3，再次清零，因此 never reaches 1s、replans 始终0，永远 walking=true。不是 MCP wait 把静止错报 arrived；wait 当前诚实报告 time/walking。

明确的循环证据在 minimal JSON：距离首节点从2.190m增加至2.259m的退步，仍因位移 headway0.792 被算为进展，stuck.t归零。

## 修复方向（本轮只提供诊断，不应用源码补丁）

首要修正 findPath 的起点连接：寻找 nearestOpen 起点候选时，要求当前实际身体位置到候选 cell center 的碰撞扫掠可达；该连接不能直接要求所有粗网格样本 open，因为起点本来就位于 coarse blocked cell。`clearLine` 含 coarse grid 条件，不能原样用作这条逃出网格单元的连接判定。goal 的 nearestOpen 调整用途与 start 不同，不应不加区分地改两者。

独立增强 unstick：改为观察一段时间内朝当前 waypoint 的距离下降/净位移，侧滑或来回抖动不应该无限重置无进展计时。仅此增强会重新规划同样的坏首段，然后放弃；可以避免永久 walking，但不能替代首段通达性修正。

出口落脚点也可避免放入 East Wing→镜框狭缝，但只改单个出口坐标会掩盖其他 coarse blocked start 的同类问题，需要更广起点连接回归。建议最终保留整条 pitch→hall 场景流程、镜框后最小起点、stop/reissue、broom/步行，以及其他场景入口/贴墙起点测试。

本报告无凭据/登记号，复现不是一小时实游统计。

# 考试沙盒与 NPC 状态隔离修复

2026-10-04 四角色一小时试玩期间，Social 在 11:31 的普通 NPC 陪练中先防御 20 秒，未收到施法、移动或 incoming；此前其他真实角色已参加 O.W.L. 考试。本专项是确定性离线复核，不计作真实一小时覆盖。

根因：模块全局 `brains` 被任意 World 的 `thinkNpcs` 遍历。`gradeExam → runCase → Scene.world.tick` 创建的考试世界不包含主世界 NPC，从而删除主世界全部 NPC 脑子。之后服务端未重新初始化它们。

实现 `2bd22f7`：将状态归属改为 `WeakMap<World, Map<string, Brain>>`，每个 World 只初始化、遍历和删除自己的状态。保留原伤害、施法选择、时序、权限与既有 NPC 状态；没有改变玩法规则或常量。

## 可复核证据

同种子、同一普通报名决斗、运行 37 秒的独立 World 夹具：

| 条件 | 尝试施法 | 成功 | NPC 伤害 |
| --- | ---: | ---: | ---: |
| 原实现，不交卷 | 4 | 3 | 44.74 |
| 原实现，先实际 gradeExam | 0 | 0 | 0 |
| 修复，先同样 gradeExam | 4 | 3 | 44.74 |

[原始基线](npc-exam-baseline.json)、[候选结果](npc-exam-candidate.json)。这是离线确定性复现，不是服务器观测伤害统计。

四项有意义的回归覆盖空的第二 World、真实考试评分、两个世界交替运行、比赛中评分保留既有咒语书和完整施法时序。[修复前全部失败](npc-tests-before.txt)，[候选全部通过](npc-tests-candidate.txt)；同四项已转为仓库 Vitest 回归 `test/npc-world-isolation.test.ts`。

修复工作树的类型检查、全部 **817 项 / 81 文件**测试和生产构建通过。试玩服务器保持原基线 `54cd8e0`，未在这一小时中途切换版本。HTTP 健康探针正常不代表 NPC 思考仍正常，本次故障说明两类证据必须分开。

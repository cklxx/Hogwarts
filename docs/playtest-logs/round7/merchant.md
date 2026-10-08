# 咒语商人试玩报告（Mundus Coin，p12，赫奇帕奇，三年级）

## 1. 目标与结果时间线
目标：给咒语定价 0–10 加隆卖钱，验证复制/fork 付费、新生免费、余额不足铸造前拒，并核账。
- 开局：年级3、XP620、声望6、加隆85、7 个原创咒均 price 0。
- 给 7 咒定价 1–3 加隆并全校广告；Tess/Percy/Nox/Ginny 多轮合作测试。
- 决斗负 Viktor 一次；打巨怪残血逃生；开庭院宝箱 +18；花 84 买两件装备压余额。
- 结算：年级3、XP635、声望1（学期折算 6→3→2→1）、加隆 **19**、学院分 0。
- 加隆对账（分毫不差）：85 + 版税10（Percy 1+3+2、Tess 2、Nox 2）− 装备84 + 宝箱18 − fork付费10 = **19**。

## 2. 规则逐项验证
- **定价卖钱（copy 付作者）**：通过。Percy 买 Exact Change/Troll Toll/Coinguard，事件原话 "copied your ... credited to you"，加隆 +1/+3/+2。
- **fork 付作者**：通过。我 fork Nox 的 m_m 成功，扣 10（23→13），lineage 记录父咒 `m_m/Nox Vale`。
- **每巫师仅一次（跨 copy/fork 共享）**：通过。Percy 二次复制被拒后改名复制成功，"NO paid field, galleons stayed 86"；我 fork 付过费后再 copy 同咒免费。
- **新生免费、作者不得钱**：通过。Tess 入学<10 分 copy m_c 返回成功、钱 20 不变，我加隆无变化。
- **新生窗口后转收费**：通过。Tess 约 15 分钟时 copy m_e "paid:2，26→24"，我 +2。
- **旧版本是否能按旧价0拿**：通过（无洞）。Percy copy {m_c,v:1} 返回 "paid:2"，按当前价收费。
- **钱不够铸造前拒（copy+fork）**：通过。余额5复制/fork 标价10 均报 "costs 10 Galleons; you have 5"，无扣款、无入书、无上架。
- **容量检查先于扣款**：通过。书满时复制先报 "holds 7 original spells"，未扣款。
- **价格边界 0–10**：直接调用通过；**batch 内被绕过（见 Bug 2）**。

## 3. 互动
DM/near/all/da 与：Tess（新生免费+转付费，两次）、Percy（付费3笔、二次复制、旧版本价、决斗约定）、Nox（上架10价咒配合、付费买 Weakness Wand）、Ginny（DA 联合打巨怪/否决测试）、Viktor（决斗负）。另用 da 发起并参与巨怪集火。

## 4. Bug
**Bug 1：只改 price 不改 desc，定价静默失效。**
步骤：对已上架咒 publish_spell 只传 `{spell,price:2}` → 返回 `unchanged:true, "v1 is already the current version"`，市场 price 仍 0。必须同时改 desc_zh/desc_en 才生成新版本并生效（带 desc 后 v2 成功变价）。期望：仅改价也应更新（价格不应依赖描述变更，或明确报错）。

**Bug 2：batch 绕过工具参数 schema 校验。**
步骤：直接 publish_spell `price:11` 被拒 `Invalid arguments ... <=10`；同样参数放进 batch → `ok:true` 并发版，11 被静默夹成 10；`price:-1` 同样通过、夹成 0。每次都新建一个不可变版本。期望：batch 内逐调用走同一 schema 校验，拒绝非法值而非静默夹断还发版。

## 5. 规则漏洞
- **免费小号刷热度**：新生复制免费但仍计入 `copies`/`popularity`（Tess 免费复制后 copies=1）。可无限 enroll 小号把任意咒语刷上 popular 榜，0 成本、作者虽不得加隆但操纵排序曝光。建议：免费复制不计入 copies/popularity，或单列 free 计数。收益：榜单曝光；约 2 步/个。
- **Bug 2 的批量夹断**本身可被用来跳过前置校验发版，建议与 schema 同批堵。

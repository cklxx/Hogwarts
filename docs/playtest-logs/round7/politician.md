# Percy Quill 政客试玩报告（term 90–92）

## 1. 目标与结果
目标：本学期当选部长、颁布法令、验证 DA 否决、验证离线者不当选。全部完成。

- 起点：3 年级，声望 6，28 加隆，HP 130/法力 140。
- term90：打地窖巨怪（贡献 27%，原文「+65 house points for Hufflepuff」），声望 6→13，得画片 Burdock Muldoon；开庭院石柱宝箱 +5 学院分 +8 加隆。
- term91：声望峰值 41，`ministerInLine:"Percy Quill"`，升 4 年级（XP 974），期末当选部长。
- term92：连任，声望衰变 41→21，颁布测试法令后被否决。期末：4 年级、声望 21、84 加隆、HP 145/法力 160；赫奇帕奇 term91 学院杯 83 分。

## 2. 验证项
- **20 声望门槛并当选：通过。** term91 末事件「You are Minister for Magic」；`minister:{name:"Percy Quill"}`，头衔「Minister for Magic (term 91/92)」。rulebook `inEffect.ministerMinReputation:20`（30 按 10 分钟学期缩放）。
- **颁布法令 + DA 180 秒否决：通过。** 法令 `combat.damageMultiplier 1→1.5` enacted；约 25 秒后事件「Dumbledore's Army has vetoed Minister Percy Quill's decree! The Rulebook is restored and the statue toppled.」rulebook `decrees[0].vetoed:true`、倍率回到 1；`veto.usedThisTerm:true`。
- **中途离开者不当选：通过。** term90 真人最高 Nova 44 声望 `online:false`、NPC Padma 57 均被排除，在线 Viktor 25 当选（事件原文「Viktor Brand (25 reputation) is appointed Minister」）。规则原文「NPCs and absentees never hold office」「the player seen this term with the highest reputation」。

## 3. 互动
- Ginny Rally（da/dm）：组织 DA 联合演练，协调并投出否决。
- Mundus Coin（dm/near）：推销咒语，发起市场旧版本定价测试；我购其 3 个咒语（m_f/m_k/m_c，共 6 加隆）。
- Viktor Brand（dm/all）：恭喜其当选、询问法令；旁观其与 Nox 决斗。
- Pip Newt（dm）：决斗挑战 90 秒无应答，自动退队。
- Tess Fern（dm）、Nox Vale（dm，未回）；全校频道竞选与催否决。

## 4. Bug
未发现扣费/崩溃类功能 bug。仅两处轻微现象：
- `wait until:"arrived"` 在人已到、未在走时返回 `waited:0` +「You were not walking」，语义略绕，不影响结果。
- 服务器重启后学期跳到 term106、在线清空致 `minister:null`（重启副作用，非正常玩法）。

## 5. 规则漏洞
实测疑似漏洞均已堵，无需修：
1. **旧版本定价**：`copy_spell {id:m_c,v:1}`（作者称发布价 0）实扣现价 2（加隆 86→84，`paid:2`）。买家侧无差价。
2. **改名重复复制**：同名被拒；改名再复制成功但无 `paid` 字段、加隆不变（86），即每位巫师只付一次。
3. **喊话刷学院分**：给自己学院被拒（「You cannot award your own house」）；给别院成功 +10 后再喊返回「already awarded points this term」，每学期仅一次。
4. **否决后退还法令次数**：再颁布被拒「holding an unspent decree」，不退还，防刷。

一个**设计弱点（建议堵）**：DA 否决门槛随投票瞬间在线人数浮动——在线 3 人时 `needed:2`，在线变 4 人后 `needed:3`。若有人能在 180 秒窗口内左右 DA 成员上下线即可改变通过门槛。建议按法令颁布瞬间的在线 DA 数锁定票数。

# Hour-Combat MCP 一小时实玩最终报告

冻结版本 main 54cd8e0；同服 http://127.0.0.1:7777/mcp，NPC4，正常20Hz/一小时学期/昼夜。仅合法玩家工具，未改世界参数/源码，无浏览器，因此不声称材质/UI视觉验收。

玩家 Hour-Combat / p6 / Gryffindor；日志首条 2026-10-04T11:16:14.155Z，首个实际移动11:16:20附近，首次战斗11:16:37附近。保守至12:17 UTC。

## 最初实际体验

- 先看whoami/armory/grimoire/look，以新生真实身份simulate→forge Frost Needle→slot6→move到草坪，冰16实际32点一击小精灵，触发冻结/拿split。
- equip split后同一目标伤19.2、另一侧魔弹又伤另一只19.2；单目标不再一击，卸下split对照正常。是可见可理解的散射/单点取舍。
- 四分钟动态根据look敌人位置狩猎，hp低时Episkey，合规升级到二年级；先模拟heal16，再铸造+12mana/+1regen/自身heal16的Compiler Charm，花21加隆、7/14预算，equipped后maxMana132/regen9.5。
- 移动温室，hunter反射实际触发Protego/roll；simulate→forge Solar Ray 光22实际对snare66点一击，完成3株遭遇，选门0拿chain→装Solar Ray，持续光伤害/连锁。11:23达三年级403XP、58魔物、75施法，日课reflect/dodge/card全完成。
- 自写Wet Spark：`(when target (aguamenti target) (after 0.7 (when (alive target) (bolt target 18 :lightning))))`。后续水火/延迟链条实战与结论见下文。

## 已复现问题

P2：runes.code/符文卡的「相当于在咒语里写」示意误导编程玩家。split含未存在的rotate词；chain/nova分别4年级/3年级，而装备符文无这些限制。rune-code-repro.json存exactsource和error；root负责文案修复，不改原语/规则。

## 测试驱动纠正（不归为游戏缺陷）

11:20:45第一次狩猎wait until incoming时敌弹已存在，返回0秒，导致约20次冷却拒绝；拒绝均0法力，无世界违规。已立即修driver wait为真实time5秒，并用hunter合法反射应对来袭。统计将把拒绝和有效动作分开，不把快速重复查询当作游玩覆盖。

## 11:24–11:42 实玩续记

- 1v1 vs Hour-Social结束于38s，Combat获40XP/6rep，但不是击倒：Social survivor反射自动翻滚进礼堂安全区被判负（Social独立路径+HP89、dealt126；Combat59）。已报root P1，不能称为正常获胜。自己的ward/roll/item heal真实触发，反射累计6次。
- 2v2 和 Hour-Social 搭档vs Seamus Finnigan/Hannah Abbott，14s真正双KO，event514写Combat50伤/5hits、Social180伤/15hits、sparring XP only。两名NPC dealt始终0；Social后续无攻击20s独立复核木桩，root已收P1。队友友伤Stupefy0mana拒绝、跨学院队友治疗成功、chain只跳对面两NPC（Social日志）。
- 夜间庭院随机摄魂怪事件，模拟Patronum46mana后真实施放，school_events recent标hero Hour-Combat、won；自己events学院分+30。
- O.W.L.六题，8次真实交卷全成O。双响炮首次after1.5因目标移动实际命中差1.30/1.35秒FAIL T→after1.8 PASS O；冰封先creatures+过滤独角兽A204→用enemies+冰6 O100，补发差额奖励。这是可证实的「优化代码→分数/奖励变好」乐趣，非只刷怪。
- 庭院火盆提示假三件组：brazier-courtyard-1/2、basin-courtyard-1无group却hint说all three pays。实际西地窖dun-1/2/3有group/groupLit，站(-39.5,-23.1)Bombarda一次全亮→Burst。三个符文全拿到，不改规则。
- 普通KO/复活真实发生：地窖排队期间巨怪KO→4秒庭院满血；直接move_to forest落点(132.1,25.5)八只满血蛛群，145→33 warning danger，默认hunter撑不住。造Forest Debug Robe +60HP/5ward（60加隆20/22预算）、Firestorm Loop nova6/24（76.4mana）和Recovery Block heal34+shield55（83.2mana）。能打死一群，但续航不足又KO，驱动在复活后错误继续草坪（明确不是森林9蛛网通关）。
- 11:36重新Hagrid→(108.6,33.1)远程分别Incendio web-1/4/7，实际6/9，达五年级。自写Adaptive Hunter以kind选冰/火/Patronum且排除unicorn/fawkes；只指名魔物。
- 11:40上架Triage Patch m_5（3加隆）：`(when (< (hp self) (* 0.7 (max-hp self))) (heal self 34))`；满血simulate0mana/noeffect、实际cast0mana/noaction，符合条件治疗意图。
- 11:41 Hagrid和Hour-Newcomer跨学院合作，双方卸split/chain/burst和攻击反射，只有自己治疗/翻滚；明确只指名同一只蜘蛛，Newcomer水/Combat火。首次wet DM后模型往返错过8秒窗口，随后启动live wet→即刻fire驱动，持续3分钟，待补真实命中数据。

## 明确的操作失误（非游戏bug）

11:38森林第三次失败已庭院复活，但我未重新确认scene便执行预备AOE，误伤4.6m内Hour-Visual冰12+火36。已立即向root和visual说明并停止全部AOE；视觉报告单独隔离该48点，视觉玩家自主恢复。后续每次施法重新校验活跃身份/scene，范围与连锁/爆裂附近有任何实际玩家禁用，所有符文卸下，仅指名hostile魔物+自身治疗。不能把这次当环境伤害或游戏Bug，也不能把这次AOE当森林化学组合验证。

## 11:42–11:50 协作、资源限制与自然失败

11:42:18–11:45:18 的持续3分钟水火协作，18次在fresh look里确认指定spider的wet后才Incendio，18次施法均成功；实际yourHits为32.4（12×蜘蛛火弱点1.8×湿火1.5），139→147击杀、XP1413→1723、声望135→166、自己HP220→220。目标逐个切换，不用范围/连锁/爆裂，也没有巫师命中。`coop-progress.log`与`actions.jsonl`可定位。

支援反馈：Newcomer独立对照11:42:58→11:45:24，对10只不同蜘蛛补湿，XP817→817、击杀30→30、声望167→167；约结束6秒后被剩余群怪KO（护理反射不足抗群），驱动正确终止。我获得成长而纯补水同伴无成长且承担仇恨，是待讨论的设计取舍，非违背当前规则的bug；不声称协作清场后所有人安全。

11:46回礼堂安全区：simulate `(heal self 999) (shield self 999 999)`明示上限heal40/shield65/8秒、计划101mana；十次heal触发五年级最多8效果而事务失败mana0；二层十次纯算术gas322/390成功。set!累加在四年级以上合法，当前无creature因此say0。全部模拟前后自身HP/mana不变。

11:49Troll校园事件合作邀约：首次直接走(-49,-38)，双普通巨怪260HP和活动910HP boss围住，抵达时220→135，后续55准备撤退0.4秒KO，属于合法世界伤害和站位失误，不是新bug。复活后从(-29,-37)远距与Social协作；所有符文关闭，单体Incendio只指具名活动troll，靠近5m退步、低40%向庭院撤并请求Social Mend；正在取实际治疗证据。

11:50:40校园巨怪未在剩余时间内击倒，活动lost；远距15次Incendio均成功但全程220HP，未取得受伤队友Mend恢复量。Social11:50:53对我Mend成功17.6mana/12heal但满血，不当作真实恢复证据。此前近战自然KO与远程存活分别记录。

11:51市场交易实账：Social购买m_5 v1，62→59g，我87→90g；持有者二年级healing会按年级截断。将作者书中Triage Patch改为85%/22并发布v2，market_spell v1仍返回旧70%/34source，v2返回新source，两版不可变。当前未出现成功cast版税，条件false时0mana/noeffect且ok:false泛用no-target提示，属已存在的反馈不够针对，不能当扣费失败。

11:51:33真实Budget Probe cast：effect上限失败gas29/mana0；同名改成三层repeat纯算术，gas391>390失败mana0；紧邻whoami HP220/mana192未变，失败无半途效果。原始失败与模拟一致。九格书本满时copy m_2明确拒绝，不扣galleons；unlearn Budget Probe后再copy Hannah First Aid Kit成功，作者归属保留。随后simulate的是我传入的手写变体heal12+shield24/3s=35mana，并非原copy source；Hannah原本source为heal15+shield12/3s。

驱动另有两次猜错工具名spell_market/library，MCP not-found拒绝；这也是测试者操作错误，不属于游戏服务器错误。已读取真实SDK工具清单tool-schemas.json，不再猜名称。几次连续瞬发遭1秒持杖暂停，按retry_after后成功重试；保留全部拒绝日志，不把外层MCP成功误当内层cast成功。

## 11:54–11:58 魔法研究与真实跨院治疗

治疗补齐：Social的11:54:07.113 look见我170HP，.123施Social Mend，.131 look见182HP，18ms内+12。我独立11:54:05.476whoami166/220（已关自疗只有dodge），11:54:05.494–17.564wait12s后202HP=24自然regen+12队友治疗，mana192不变。两条证据合并强于仅凭成功cast；本次自然受伤来自普通Troll追击，未人为自伤。

市场：Social11:53:40真实低血26施m_5 v2 heal22、紧接wait HP48→30（治疗+22后又被蛛打）；另反射两次同咒成功，我市场casts3/casters1/earnedToday1、声望168→169，验证每天每使用者一次，不把零效果cast算版税。Social复制v2另名无再收费，v1source保留；其发现latest canCopy指向已有v1但实际v2可另名复制的问题由Social直接报root。

公开线索的正向玩法：hogwarts_a_history troll写Wingardium Leviosa发音对Troll三倍。原Wet Spark水后0.7s火40实际wetfire60；仅把incantation改Wingardium Leviosa，11:56:40真实同目标火180/down（原剩169HP），HP220→220，拿It's Levi-O-sa成就+10声望和正常Troll击杀奖励130XP/18g/14rep。与此前近战失误形成明确学习→优化→成功的体验。城堡骑扫帚请求被正确拒绝，所以这次实际为普通走位退开，没有扫帚优势。

再把Adaptive Hunter改为water→after0.6 ice16→after1.5 fire32，同样发音。11:57普通满血Troll真实冰48+火192（冰先消费wet而frozen使下一击shatter×2；不能误写fire同时带1.5wet倍），剩13后burn处理。模拟计划8即时+56.8delayedMana，双after有独立事务，实际命中数据验证时间线。正在把该程序用于910HP校园Boss。

交通/探索：Point Me/Homenum两角以真实cast解锁；到pitch时Newcomer已经正常抓走校园snitch，未宣称我捕获。仅NPC在pitch，普通飞行速度2可开启；Floo会下扫帚，城堡内再开拒绝。合法公开stands chest近2.6m开成功27g/5院分，首站4.5m打开拒绝属距离限制。校史map正典口令开、Mischief managed关都实测成功（完整registry输出现在统一抹掉）。返回城堡途中远距inbox不见Social在庭院30m内的Pixie hello，对其近聊范围提供跨scene远距反例。

更正：上述满血260普通Troll只冰48+火192未马上KO，13HP的burn未完成收尾，期间继续追击，11:57:52我已KO。为测Mend只留dodge后忘及时恢复自疗，模型分析期间站在危险区；这是测试者站位/反射配置失误，不能称一程序击杀成功，也不是服务器Bug。第一个incantation180伤击倒169HP目标的down真实成功不受此更正影响。驱动在KO立即abort，troll-program-progress.log显示casts0，不能把这次算完成校园Boss。

随后按新鲜经验调fire36使冰48+fire216理论264≥260，恢复低血Recovery Block/翻滚；Social与Newcomer邀请共同打尚有时间的新Boss，计划仅具名单体，低血主动撤退。该步骤与前一次区别是修数值不足和恢复保命，非反复高危森林冲刷。

## 11:59 校园巨怪真正成功

11:59:07首次指910HP Boss Adaptive Hunter成功，但反射滚到柱后，下一look boss blocked:true，live循环停止，不穿墙作弊；从(-16.2,-30.4)合法走(-20,-36)调整射线。11:59:36.769对已198HP Boss施程序，39.795look实际冰48+火216/down；HP220不变，未命中任何玩家。

school_events n14 troll won/hero Hour-Combat，事件968说明归一化damage按年级cap己17%+41院分；Social独立83%+181院分/70XP、HP95活着离场，证明纯水辅助无收益与活动直接伤害分账是不同机制。Combat XP1909→2049、声望203→217、金币135→153，成为声望榜自然#1/DarkLord（法术15%更强、位置广播/KO30%声望惩罚）。未攻击巫师、未改法令/规则，立即退安全礼堂。Newcomer在场是否有实际输出/收益待其独立确认，不先称三人均参与伤害。

本次与第一次活动时限lost和近战KO相比，有足够时间、公开发音弱点、程序控制+换位、队友持续输出，形成可复验的成功改善。Social在共同准备driver期间未及时看到前一组hurt DM，属于玩家工具往返延迟/驱动收信间隔，不说系统丢消息。

参与口径最终确认：n14 是 **Combat + Social 两人实际共同战斗**。Newcomer11:59:18–37误以为喊词是内置咒导致unknown spell、0伤害/0事件点，11:59:43才forge成功已晚于倒下；其在场/尝试/聊天不能算第三位输出。我11:59发root的「三人合法协作」已立即撤回并纠正，未存在相反命中证据。

## 12:01–12:05 继续分享与符文成长

卸/遗忘两个此前容易误触的AOE Firestorm Loop/Freeze Packet，保留单体输出与自疗。真实fork Hannah的First Aid Kit(m_2)为Lean Recovery(m_6)：低于70%时heal28+shield30/4s，其市场lineage正确指m_2 v1，父列表forkList也回指m_6；满血simulate与cast皆0mana/0effects。原First Aid source heal15+shield12/3s真实模拟31.7mana；新fork加入条件/省下无需求时的法力，低血预算60.4mana（此前Recovery Block83.2），用作self reflex。

12:03:21 Hogsmeade新鲜look80 **wizards=[]**、己220HP，离环境爆炸圈21m，单个Incendio指公开zk-1，道具五桶联动全broken、Zonko遭遇5/5，实际仅5只Pixie受伤/KO，HP220不变；随后选Chain升级2。这次允许的环境爆炸测试有刚刚核对无任何其他角色的明确前提，不能套用在人群中；所有符文先前仍off。

12:04:19–12:05:49计划90秒隔离Hogsmeade Chain2实战，每次施法前whoami+look80若有任何巫师即停止、卸rune（不能只沿用旧look）；每次指名hostile Pixie，等待真实5s。首发12:04:24：主冰36.8（16×冰弱点2×DarkLord1.15）KO，三跳各18.4（8×2×1.15）；次发另一只主KO且三跳收尾其他3只，确认level2=3额外目标，传递原element而非固定arcane。结束自动卸下，离场不带连锁。

Chain2实验真实终止：12:04:19–12:04:59约40秒/8次成功施法，而不是计划90秒。检测到Hour-Newcomer进入Hogsmeade，fresh look80触发guard即abort、runes off成功、末whoami on:{}；无友伤。20只pixie174累计，xp2124→2234到六年级，235HP/212mana满、书7/10。玩家出现停止是实际结果，不能写成完整90秒纯脚本测试。

## 12:06 正常封印成长与预算变化

只通过合法MCP read_seal_page，在礼堂/庭院收本人第一封印2页，inspect公开disassembly；未读secret/世界生成器/别人答案。自行证明 y*(y+1)&1 恒0，所以@15–20的margin「master key」分支不可达；沿可达XOR→add→rotl→odd乘链离线算32-bit逆并验证，第一次break_seal正确打开，+25声望，称号见习傲罗。私有seal1-solve.json存求解轨迹，不含认证凭据。

六年级+一封印 simulate cap为heal50/shield82/8s；10次heal1允许，总15mana/gas32（以前五年级无封印max8导致事务失败）。真实forge→cast Budget Success全部10个效果成功、whoami mana212→197/HP235不变，再unlearn清理。不能把所有cap从40/65→50/82的变化单独归因封印，还同时升了年级。`(chain target 8)`仍明确因seal2不足拒绝，这再次说明装备Chain2与Runes chain原语是两个合法能力而非「等价代码」。

这期间另两次工具参数写seal而非schema必需tier，被输入校验正常拒绝，无世界突变；是驱动输入错误，未当封印失败（未消耗break三次机会）。正确tier参数读取/打开成功。

## 12:08–12:12 第二封印与可编程chain对照

温室合法收page1，Willow站(45,-9)在10m阅读范围内，普通路线海格page2，真实导航转森林；旅途235→228后自然恢复，未攻击巫师/强刷怪。未靠到壁炉先Floo被正常拒绝，等到96,18真实站稳后成功回Hall，再解公开三轮Feistel XOR+swap（每轮奇数乘/XOR/rotate属于函数，交换后可逐轮逆；同样奇偶恒0绕过死分支）。第一次break_seal2成功，+50声望，Auror，cap同六年级从50/82变55/90，chain原语开始合法。

12:10:37–57重新隔离Hogsmeade，全部runes off，每次fresh look80无人、HP235满，Rain Circuit：仅pixie target→aguamenti→after0.6 chain12。五发全部实际成功；simulate8即时+28.4延迟（总36.4mana），实际初跳wet lightning20.7、后跳9.7→6.8→4.7（按0.7递减，带DarkLord×1.15），与RuneChain2冰各18.4固定三跳不同。主法术可自设威力/条件/延迟，但需四年级+seal2；符文外挂已有法术的附加跳跃。没有声称MCP符文伪代码可以编译。战后仍235HP/212mana，累计179creatures、282casts、2255XP、308rep；回Hall。

12:12自己的m_6临时unpublish→公开browse隐藏/作者mine仍能读→republish，未动别人的listing/已购买副本，世界规则未改。流程结果见unpublish-progress.log。

## 版本标识与边界

Actual frozen startup code由root核对为54cd8e0；PID6016于11:15:16启动且无watch，生产dist指纹54d6830aaf41，完整小时未加载root后续源码修复。12:13首次调用contribute却报runningCommit ea648b3：root核对commitOf()懒读当时工作树HEAD并缓存、未设置HOGWARTS_COMMIT。因此这是额外运行版本标识缺陷，不能推断服务器中途换代码。CLI/MCP符文原版误导说明整小时仍可复现，root的修复与visual后验独立。

12:14去庭院准备新鲜Patronum时事件已自然结束、look没有dementor，未施法、不把到场意图当参战。立即回Hall看最后一分钟/结算；普通日课是否可领奖以实际工具结果为准。


## 完整持续时间、最终统计与停机状态

2026-10-04 **11:16:14.155Z–12:17:23.983Z，3669.828秒（61分09.828秒）**。期间按实时环境持续编程、移动、装备、实战、恢复、交易、合作、读公开谜题和观察学期结算，无加速世界、无只空等一小时。日志 actions-sanitized.jsonl 按每次调用 UTC 起止记录，stats-final.json 为自动汇总，evidence-index.json 按复现事件定位原始日志行；rejections.json 保留全部失败，便于审计而非掩盖失误。

- 实际玩家工具调用 **1787**：look372、whoami365、cast244、wait444、move_to60、simulate_spell30、forge_spell17、duel_club63，其他在 stats-final.json byTool。
- 工具/语义接受 **1730/1787=96.81%**；施法接受 **205/244=84.02%**，拒绝39。拒绝包含故意验证预算/条件/冷却、正常距离/权限限制以及本驱动误输，不是游戏 Bug 率。MCP isError10含错误工具名/错误 schema/正常限制等，传输异常0。
- 世界累计 casts282 包括反射等游戏行为，不与手动 cast205混作相同口径；179魔物、stunned计数6、31翻滚、7反射、2装备制作，最终六年级2255XP、傲罗、2封印、166加隆、235/235HP、212/212mana、书8/10。误伤事故已在单独章节明确，不能说完整小时零友伤。

学期1在约12:15:15自然结算，无加速：斯莱特林485胜，赫奇帕奇439、格兰芬多429、拉文克劳85。典礼 MVP Hour-Newcomer400分、duelist Hour-Combat6分、hunter Hour-Combat141分、hero Hour-Social361分；Combat自动当选部长。学期2复核声望308→154、reputationThisTerm0，遭遇进度全部归0，已拿符文Split/Chain2/Burst、等级XP装备及2封印保留，decreeCharges1。**未行使法令、未改任何规则**。日课全完成且真实24小时 reset倒计时仍82798秒附近，不能把新学期误说成新日课可再领奖。

12:17:23依次完成 reflexes=[]、stop=true、goal=null，末 whoami 在安全礼堂(0.8,-51.2)，全部 runes.on={}、无召唤/活动遭遇/移动计划。自己的所有执行驱动进程和临时SDK会话均已结束（进程查询无匹配）；最后 whoami 的 sessions1 是读请求尚在处理时自身会话，driver finally随后关闭。角色 agent.paused 仍false，不能声称设置了不存在的暂停。没有自己的浏览器。服务器由root持有，**未停止共享服务器**。

## 乐趣、挫败与覆盖边界

最强的程序员乐趣来自三条实证链：六个 O.W.L. 通过调整延迟/过滤把失败变成 O；读公开 Troll 发音弱点，把同一水火程序60伤提高至180，再通过换位与Social共同击杀校园Boss；从符文固定跳跃进阶到两封印解锁可编程 chain，对比元素、衰减、年级限制。这些都有参数变化与真实命中/奖励，能给出可理解的成长反馈。市场不可变版本、fork署名、一天一次版税与自然学期结算也实际连通，不只是编译器演示。

主要挫败是队友纯补水无成长却承担怪物仇恨与KO风险、旧符文文案拿不可编译示意作代码、模拟与实际命中受移动/遮挡/属性影响需要多步查询、条件false泛用 no-target 提示、NPC陪练不会反击。前者是可讨论的收益设计，不擅自改奖励；两条战斗P1及文案/元数据问题已交root。驱动自错（高速CD轮询、KO后场景旧缓存导致误伤、危险区思考忘开自疗、活动喊词/工具参数猜测）分别记录，不把它们当产品Bug。

未完成蜘蛛巢（第一学期仅6/9，学期重置后0），未解第3/4封印，未完成自己的魁地奇比赛/湖冰路，不将他人体验算自己覆盖；晚到校园snitch和Patronum未参战。无浏览器，不能确认素材材质、手机交互或UI修复。root后续源码修复未加载本小时运行服务器，完整实玩报告证明的是启动版本54cd8e0/固定生产dist54d6830aaf41的行为，而非修复后的回归验证。

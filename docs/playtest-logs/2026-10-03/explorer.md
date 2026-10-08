# ExplorerAsh 探索与战斗 MCP 试玩报告

日期：2026-10-03。本地服务器 http://127.0.0.1:7777/mcp；角色 ExplorerAsh，Ravenclaw。使用真实运行的游戏工具逐步交互，未改存档、内核或源码；密钥只由客户端保存在本地文件，没有打印。约 65 次有效工具交互，持续约 10 分钟（出生世界 t=73.4，后续跨过第一学期结束）。这属于 Agent 文字端实玩，不代表真人 UI 手感或真人趣味评分。

## 已完成目标

- 经 instructions、tools、whoami、grimoire、look 熟悉玩法，设置 hunter 反射规则。
- 城堡、黑湖、禁林、霍格莫德共 4 场景真实到访。飞路从庭院到黑湖、海格到霍格莫德、霍格莫德回黑湖均成功。
- 在黑湖骑扫帚，返回 riding:true/speed:2；move_to hagrid 自动跨场景到禁林。
- Stupefy 击杀小精灵 c1cl4，look.yourHits 返回 damage:14/down:true；后续烟火连锁后 stats.creatures=6。
- 对庭院火盆施放 Incendio；点亮 Tempus 和 Revelio；湖边三水盆 Glacius 实测 lake-1/lake-3 state:awake（其中 lake-2 一发没点亮，未确认是否途中被别的物件挡住）。
- 海格宝箱按 look 的 6.3 米提示走近并开启，得到 Myrtle 蛙片及 +5 学院分。
- 根据 encounters 指示，在霍格莫德向 zk-3 发 Incendio，烟火桶连锁达 5/5，遭遇完成；选钱袋 +10 加隆、+30 XP，升到二年级。
- 黑湖白天从飞路 (-82,26) 向 (-101,40) 施放 Glacius，move_to 后抵达 (-100.8,39.9)，黑湖冰路遭遇 1/1 完成；选择 Chain 符文并成功装在 Glacius 上。
- 期末最终数据：year 2、XP 157、Galleons 41、reputation 3（此前同一学期为6，期末衰减）、HP115、creatures6、skate17.0625米。起始为year1/XP0/G20/rep0/HP100。学院分明确至少宝箱 +5，未单独读取总分，不能补算。

## 确认的体验卡点与复现

### 高优：黑湖 move_to 接受目标后长期卡岸边

1. 白天从 (-82,26) cast Glacius aim(-101,40)，move_to(-101,40) 正常完成冰路。
2. 原地处理奖励、装符文等直到冰路消失，被移回约 (-87.5,39.8)。这次回岸没有在我查看的 look 中给出原因（可能其他事件渠道另有说明，尚未确认）。
3. 夜间 look 显示 hour21.6/night:true，提示夜里湖面会结冰。
4. move_to(-101,40) 返回 distance14、etaSeconds2；随后 wait until arrived seconds8 返回 waited8.1/reason:time/moved0.2/walking:true/at(-87.5,39.3)。
5. stop 后在岸边再次 cast Glacius aim(-101,40)，结果ok；再move_to、wait8，依旧卡(-87.5,39.4)，walking:true。
6. 退回(-82,26)，再move_to(-101,40)（这次无新冰咒）仍卡(-89.7,28.6)，wait8返回moved0.1/walking:true。

期望：目标不可行则清楚拒绝或终止路径说明；可行则寻路避障后进入冰面。不能一直给 ETA2/3 秒却持续 walking。注意：暂不能确定根因是夜冰判定、岸边障碍，还是路径点与碰撞不一致，需工程侧查证。已即时报告主 Agent。

### 中优：跨场景路径 ETA 只显示首段

黑湖飞路位置骑扫帚，move_to landmark:hagrid 返回 walkingTo:Hagrid's Hut/distance15/etaSeconds2。实际穿雾后到禁林 (94.7,37)，wait 在调用时仍等4.9秒才arrived；look显示hagrid在(95,30)距7米，角色地点仍叫Forbidden Forest。可能是建筑点调整到可达门外，不能认定坐标错误；但应明确 ETA 是首段、实际目的地是入口，否则容易误认为抵达错误位置。

### 低优：wait 的“未走路”说明容易误导

多次 move_to 数秒短程后紧接 wait，途中已经完成，工具返回 reason:arrived，但 note="You were not walking: move_to first..."。用户确实刚走完，建议区分“已抵达”与“从未开始”，避免让新玩家重复发 move_to。

### 低优：look radius 对物件段不明显生效

look radius10/12仍列出约20~30米外的很多 props（30条左右），而creatures遵守更小半径。文字端查附近东西时噪音大。可以明确物件独立半径，或让radius一致裁剪。尚不应当作性能根因。

## 互动与局限

- 看见同服 PhoneNova，但未聊天或合作；本轮侧重独立探索及真实战斗。
- 常规 CLI 工具墙钟约1.5~3秒（含 npx/tsx 启动），wait8约10秒；没有独立测服务处理耗时，不能以此认定服务器延迟。
- 没跑浏览器，不对帧率、画面质量、操控或真人趣味打分。
- 尚未完成温室/蛛网遭遇；没验证夜冰是否最终到更深夜开始正常，也没验证湖盆三件同时冻结奖。
- 后续应先回归岸边卡点，再对导航拒绝/进度反馈做真实路径重测。

## 修复后回归（第二轮，已完成）

沿用原 ExplorerAsh 密钥，安全重启后角色、位置和符文均保存。重连 look 为清晨6.6/night:false，角色(-89.8,28.4)。先回归白天冰路：

1. move_to(-82,26) 返回 distance8/ETA1。
2. cast Glacius aim(-101,40) 返回ok，mana21.8。
3. move_to(-101,40) 返回distance23/ETA3。
4. wait arrived8 返回reason:arrived、walking:false、坐标(-100.7,39.8)，抵达成功。
5. encounters 中 lake progress1/need1/doneThisTerm:true，可以领取奖励，选Chain升2级。

结论：白天冰咒造路无回退，原角色保留正常；夜间尚待自然到来再复测，未改游戏时钟。

等夜间期间额外尝试蜘蛛巢：飞路至海格，move_to(129,36)，周围6只蜘蛛；hunter反射发生翻滚、Protego、Episkey，但尝试分别向web-7/web-1/web-4发Incendio没有推进遭遇（0/9），随后发现已回庭院，属于本次战斗失败，未把它记为新Bug。工具施法回复不显示自身受伤或当前地点，连续施法时可能不易察觉已经复活；应穿插look/wait观察。

### 夜间真实回归结果：已通过原东岸入口

不改时钟，持续用游戏 wait 自然等夜间；从下午14.6到19.2，角色在黑湖飞路(-82,26)，没有再施放Glacius，避免残留魔法冰干扰。随后wait45收到世界事件：`The Black Lake freezes over — the ice will hold you.`

- 第一次夜间move_to(-101,40)途中被摄魂怪打倒。wait返回HP0/state stunned/at(-89.3,33.7)，这次不算导航成功或失败（遭敌中断）。其reason却显示arrived，体现wait不能区分战斗中断与到达的既有反馈问题。
- 复活后从庭院飞路回黑湖(-82,26)，立即move_to(-101,40)，distance24/etaSeconds3；紧跟`wait {until:"arrived",seconds:2}`，实际返回`reason:arrived`、`walking:false`、`state:"in the world"`、`at:{x:-100.6,z:39.8}`、HP84/Mana59。
- 本次没有施任何Glacius，夜冰自然存在，成功越过原来卡在(-89.7,28.6)附近的东岸，走到浮标区域，夜冰入口修复真实回归通过。
- 下一次look显示已经被夜间敌人击倒复活，世界hour22.6/night:true，庭院也有校园事件摄魂怪。后续死亡风险与导航成功独立记录，不将其当作路径修复失败。

第二轮结论：原角色持久化正常；白天Glacius入湖通过；夜间不施冰咒从黑湖飞路到(-101,40)通过。没有重复覆盖全部岸点，只真实验证了本轮旧卡点对应的东岸路线；工程側可用确定性测试补齐其他入口。

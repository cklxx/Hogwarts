# Hogwarts — 一个"咒语就是代码"的 3D 魔法世界

浏览器里是一个 Three.js 低多边形霍格沃茨；服务器是权威的世界内核；同一个内核通过 **MCP** 暴露给你本地的 Agent。
Agent 能查询你的身份、武器库、魔法库，**用一门小语言（Runes）写出新咒语**、给角色锻造魔法道具、甚至替你走路和决斗。
打小怪攒经验升年级、决斗攒声望；**每学期末声望第一的人成为魔法部长，获得一次改写整个世界规则的机会**。

```
npm install
npm run build        # 构建 3D 客户端
npm start            # http://localhost:7777   MCP: http://localhost:7777/mcp
```

开发模式：`npm run dev`（Vite 5173 + 服务器 7777 热重载）。测试：`npm test`。类型检查：`npm run typecheck`。

## 接入你的 Agent

**一次配好，之后每个新会话自动回到同一个巫师。** 在霍格沃茨仓库目录里运行一次（命令会记下完整路径）：

```bash
claude mcp add -s user hogwarts -- npx tsx "$PWD/src/mcp/stdio-bridge.ts" http://localhost:7777/mcp
```

然后进游戏按 `Esc`（猫头鹰邮递）→ **生成配对码**，对 Agent 说一句：*"连上霍格沃茨，配对码 ABC-DEF"*。
stdio 桥会把密钥存进 `~/.hogwarts/credentials.json`（0600），并把它从模型看到的文本里抹掉；服务器重启时自动重连。配对码 6 位、180 秒、只能用一次、失败限速。

- **HTTP 直连**：`claude mcp add -s user --transport http hogwarts <url>/mcp -H 'Authorization: Bearer ${HOGWARTS_TOKEN}'`，在 shell profile 里 `export HOGWARTS_TOKEN=…`。没配头也能 `pair`，结果里的 `remember` 会教 Agent 把密钥记进自己的记忆、下次先 `login`。
- **Agent 先注册**：`enroll` 返回 `http://…/#k=<token>` 链接（密钥在 `#` 后面，不进服务器日志，页面打开后立刻从地址栏抹掉）。
- **密钥泄露**：`rotate_key` 或菜单里的「更换密钥」，旧钥立即失效。
- 示例：`npm run bot -- "Neville Longbottom"` 是一个脚本化"Agent"，通过 MCP 入学、铸造自己的咒语、按弱点挑选法术猎杀生物。
- 没有 Agent 也能写咒语：游戏里按 `B` 打开**咒语书**，可阅读课本咒语源码、编写 Runes、免费模拟、铸造并放上快捷栏；底部附完整 Grimoire。

### 边玩边和你的 Agent 说话

- 按 `O`（或聊天框以 `@agent ` 开头）打开**猫头鹰**：只有你和你的 Agent 能看到。Agent 用 `tell_player` 回你，可以带 2–4 个选项按钮提问；用 `listen` / `wait(until:"owl")` 收你的信。
- HUD 左上显示 Agent 在线状态、最近动作和它写下的目标（`set_goal_note`）。**人永远优先**：你一按 WASD 或点地面，Agent 的寻路立即让路；「暂停 Agent」后它只能看和跟你说话。
- 颁布法令这类不可逆操作，Agent 会先 `confirm_with_player`：浏览器在线就在游戏里弹确认，否则在终端里问（MCP elicitation）；拒绝、取消、超时都算"不"。
- 想让 Agent 在你说话时主动"醒来"：Claude Code 的 channels（研究预览）经 stdio 桥推送，`claude --dangerously-load-development-channels server:hogwarts`；不开也没关系，`listen` 在任何 MCP 客户端都能用。
- 设计与取舍：`docs/AGENT_LINK.md`。

然后对 Agent 说：*"读一下 grimoire，写一个专门收割残血敌人的咒语，放到 6 号快捷栏。"*

## 操作

新手引导会一步步带你走一遍（可跳过，`H` 随时查看全部按键，帮助面板里可重开引导）。

| 操作 | 按键 |
|---|---|
| 移动 | `WASD`（跟随镜头方向，镜头会慢慢转到你身后）；**左键点地面**自动寻路走过去 |
| 选目标 | 鼠标**靠近**目标即可（屏幕距离 48px 内），`Tab` 在前方敌人间循环，顶部显示目标框 |
| 施法 | `1`–`6` 或点快捷栏；没有目标时自动选：攻击咒语打前方最近的敌人，治疗咒语给队友或自己；左键点敌人 = 锁定 + 施放当前咒语 |
| 交互 | `F`：在地标处阅读禁书区书页、扶起倒下的同院队友 |
| 面板 | `B` 咒语书 · `R` 禁书区 · `L` 排行榜 · `H` 帮助 · `Esc` 菜单/猫头鹰邮递 · `Enter` 聊天 |
| 镜头 | 右键拖动 / `Q` `E` 旋转，滚轮缩放 |
| 手机 | 左下虚拟摇杆，点按选目标/攻击/走路，拖动看，双指缩放 |

## 架构：机制与策略分离

```
 3D 浏览器客户端 ──WebSocket──┐                 ┌── MCP (Streamable HTTP /mcp, stdio bridge)
   (只渲染 + 发输入)          ▼                 ▼        ↑ 本地 Agent
                     ┌────────────────── World (kernel) ──────────────────┐
                     │ 20Hz tick: 延迟咒语块 → 巫师移动/回蓝 → 弹道 → 生物AI │
                     │ → 打人柳 → 刷怪 → 法律脉冲 → 学期结算                 │
                     │ syscalls: enroll / cast / forgeSpell / forgeItem /   │
                     │           decree / look / say ...                    │
                     └──────┬────────────────┬──────────────────┬──────────┘
                            │ reads          │ executes         │ collides
                     Rulebook (policy)   Runes VM (magic)   shared/map.ts
                     zod schema = 宪法    解析→静态检查→       同一份数据驱动
                     decree = merge patch  gas 解释器→事务提交  碰撞与渲染
```

| 抽象 | 文件 | 职责 |
|---|---|---|
| `World` | `src/kernel/world.ts` | 唯一可变状态 + 固定步长 tick；所有输入（WS/MCP）都走同一组 syscall |
| `Rulebook` | `src/kernel/rulebook.ts` | **所有**可调参数（伤害/治疗倍率、元素、PvP、安全区、法力、每个原语的成本倍率、禁用原语、幻影移形、不可饶恕咒、经验/声望倍率、生物开关与强度、昼夜天气、学期长度、法律）。内核只读它 |
| Runes | `src/runes/*` | 咒语语言：`parser` → `checker`（作用域、元数、年级门槛、复杂度）→ `interp`（gas 计量）。一张原语表 `primitives.ts` 同时驱动校验、成本、年级门槛和文档 |
| 施法事务 | `src/kernel/magic.ts` | 程序在只读视图上运行，**只规划**效果；通过全部检查才一次性提交 |
| 共享地图 | `src/shared/map.ts` | 障碍物/区域/地标；服务器碰撞与客户端建模读同一份数据 |
| MCP | `src/mcp/server.ts` | 每个 MCP 会话绑定一个巫师；`grimoire` 从原语表自动生成 |

## 规则

### 身份
入学时分院帽分院（可指定学院；"not Slytherin" 会被尊重），奥利凡德配魔杖（木材/杖芯/长度；杖芯给永久加成：凤凰羽毛 +1.5 回蓝、龙心弦 +8% 伤害、独角兽毛 +15% 治疗与护盾）。
每个巫师有三个标识：**token**（秘密，用于登录）、**registry 号 `wz_xxxxxxxx`**（魔法部档案号，默认不公开）、**handle `p1`**（公开，快照与瞄准用）。

### 咒语即程序（Runes）
```lisp
; 残血收割者：对残血目标用大雷击，否则用便宜的一发
(let t (or target (first (enemies 30))))
(when t (if (< (hp t) 20) (bolt t 16 :lightning) (bolt t 10)))
```
让自定义魔法可行又不破坏平衡的规则：

1. **静态检查**（铸造时）：未知名字、元数错误、年级未解锁的原语、复杂度 > `40 + 25×(年级-1)` 个 AST 节点、被法令禁用的原语 → 拒绝，并给出行列号。
2. **gas 计量**：每次求值 1 gas、每次查询 +2；上限 `150 + 60×(年级-1)`。死循环不可能（`repeat` ≤10、`each` ≤16、嵌套深度 ≤24）。
3. **事务化施法**：效果先规划再提交。出错、耗尽 gas、效果数超过 `3+年级`、法力不足 → **整个咒语失败且不扣法力**；否则全部生效。
4. **成本公式固定**：`法力 = 2 + Σ 效果成本 × Rulebook 倍率`，例如 `bolt` 成本 = 威力（元素 ×1.1），`nova` = 威力×(1+0.35×半径)。超出年级上限的数值被**截断并告知**（不是报错）。
5. **冷却** = 0.3s + 法力/60；全局冷却 0.25s。`(after 秒 ...)`（二年级）延迟块是独立事务。
6. 标准课程（Stupefy、Incendio、Protego、Expelliarmus、Expecto Patronum、Bombarda……）**用同一门语言写成**，按年级自动发放 —— Agent 可以直接读它们当范例。

效果原语与解锁年级：`bolt heal shield light say`(1) · `push haste disarm`(2) · `root nova patronus`(3) · `apparate`(6，校园内默认失效)。

### 道具
`forge_item`：预算 `6 + 4×年级` 点附魔（maxHp/maxMana/manaRegen/speed/power/ward，各有上限和单价），价格 3 加隆/点。可附带 Runes **charm**：按锻造者年级校验、由持有者以 8 折法力使用、但数值上限按**持有者**年级 —— 高年级可以"武装"低年级，而不是替他们越级。

### 成长、声望、学期与部长
- 打怪（小精灵/魔鬼网/八眼巨蛛/巨怪/摄魂怪，各有元素弱点）→ XP、加隆、少量声望；XP 决定年级 1→7，升级解锁新原语、更高上限和新课程。
- 击晕其他巫师 → `10 + 对方声望×10%`，对方失去同样的 10%；同一对手 60 秒内重复击晕不给声望（防刷）。大礼堂是安全区。
- 每学期（默认 15 分钟，`TERM_SECONDS` 可调）结束：本学期声望按学院汇总颁发**学院杯**；**声望最高者（≥100）被任命为魔法部长**，获得 1 次法令；所有人声望 ×0.5。
- **法令（decree）**：对 Rulebook 的 JSON merge patch，每个值必须落在 zod schema 的"宪法边界"内；可以附带最多 5 条**法律** —— 世界在 `kill / respawn / cast / pulse(每 10 秒)` 事件上运行的 Runes 程序。`dry_run` 默认开启，确认后再生效。下一任部长上任时，上一任未用的法令作废。

### 称号
每个人都有自己的称号，从最低的 **麻瓜 Muggle** 开始：麻瓜 → 哑炮 → 学徒 → 巫师 → 级长 → 见习傲罗 → 傲罗 → 大巫师 → 威森加摩首席 → **梅林**。称号由年级、破解的禁书区封印数、是否当过部长共同决定，只升不降（Lean 已证明单调）。

### 魔法解锁的四角视野
HUD 四个角默认是暗的，要用魔法点亮（新原语 `reveal`）：**Tempus** 右上角时钟与学期 · **Revelio** 左上角你的声望/加隆/封印进度 · **Point Me**（二年级）左下角雷达小地图 · **Homenum Revelio**（三年级）右下角附近巫师的方向与距离。

### 禁书区：越大的魔法越像解谜
四道封印守着更强的魔法（上限 +20%/40%/60%/80%，第二道解锁 `chain` 连锁闪电，第四道解锁 `storm` 延迟风暴）。每道封印是一段**"古代如尼汇编"**（自定义寄存器机，符文助记符，如 `TIWAZ` 读输入、`HAGAL` 数据相关循环移位、`PERTHRO` 比较跳转）：
- 由**服务器私钥 + 你的 registry 号**生成，每人不同；源码公开也没用，答案只在服务端校验；
- 高阶封印是多轮 Feistel 网络 + 密钥调度循环 + 数据相关旋转，唯一解（Lean 证明了 Feistel 轮的单射性）；
- 生成的汇编里故意放了**不可达的诱饵块**（带 "master key accepted" 注释）、看似依赖输入实则恒不跳转的**不透明谓词**（v·(v+1) 恒为偶数）、和**会说谎的页边注释**；
- 书页散落在城堡各处，必须亲自走到地标旁阅读；每道封印每 10 分钟最多尝试 3 次，每次失败被反咬 15 HP；年级门槛 2/4/5/7。

> 诚实的边界：在**同一台机器**上，能读服务器存档（`data/world.json`，含私钥）的 Agent 可以直接算出答案。封印防的是只通过 MCP 游玩的 Agent。

### 治愈、魔物与召唤（统一的"光环"层）
所有持续状态都是**光环**（`src/kernel/auras.ts`），巫师与生物共用、tick 统一结算、`cleanse` 统一驱散；同类光环刷新时长并取较大强度，所以叠加不会越过单次施法上限（Lean 已证）。
- **治愈系**：`regen`（Ferula，持续治疗）· `cleanse`（Finite Incantatem，解定身/缴械/毒/灼烧/冰冻/诅咒）· `revive`（Rennervate，原地扶起被击晕的巫师）· `mend`（Vulnera Sanentur，范围治疗本学院与自己的召唤物）。所有治疗都受 `healingMultiplier` 与最大生命约束。
- **元素附带效果**：火→灼烧，冰→减速（Rulebook `combat.elementStatuses` 可关）；八眼巨蛛咬伤带毒；阴尸（夜晚湖边，怕火）冰冷的手让人减速。
- **友善魔物**：独角兽（禁林，靠近它会缓慢回血；伤害它=诅咒，最大生命 -30%，5 分钟）；凤凰 Fawkes（白天稀有出现，无敌，为重伤者流泪治愈并驱散负面状态）。
- **召唤**：`summon :serpent`（Serpensortia，二年级）/ `:birds`（Avis，三年级）。召唤物**完全继承主人的敌我关系**、永不伤害主人，击杀记在主人名下，攻击它=攻击它的主人；主人倒下即消失；同时数量受 `magic.maxSummons` 限制（新召唤替换最旧的）。

### NPC 巫师
4 位原著同学（Seamus、Hannah、Padma、Goyle）是**真正的内核巫师**，走同一套 syscall：巡逻、按弱点选咒语打怪、受伤用 Ferula/Episkey、中招用 Finite Incantatem、扶起同学院倒下的人、偶尔召唤蛇、只反击先攻击它们的人、说原著台词。它们不能当部长、击晕它们不给声望。`NPC_COUNT` 可调。

### 胜者改造世界
- **学院杯**：学期末得分最高的学院，旗帜会挂满城堡（天文塔、主楼、两翼）。
- **部长法令**除了改规则，还能重新装饰世界（纯视觉，schema 限定范围）：`world.aesthetics` 的 `skyTint`（全局调色）、`sunIntensity`、`fogDensity`、`glow`（泛光强度）、`bannerHouse`、`lanterns`（漂浮灯笼）、`fireworks`（韦斯莱烟花）、`aurora`（北方极光）。
  例：`{"world":{"aesthetics":{"aurora":true,"fireworks":true,"skyTint":"#ffd0a0"}}}`
- 每道生效的法令都会在城堡入口大道两侧**为部长立一座铜像**（带学院色基座、铭文为部长宣言、夜间有补光），最多保留 8 座。

### 画面
表面贴图用开源素材（`client/public/textures/CREDITS.md`）：ambientCG **Bricks076A** 全套 PBR 做城堡石墙与庭院石板、Poly Haven 碎石/苔岩/岩石、three.js 示例的草地/硬木/水面法线（MIT）、Poly Haven HDRI（quarry_01 日间、moonless_golf 夜间）做基于图像的光照、three.js 镜头光晕。加载失败时回退到下面的程序化贴图。
程序化部分在浏览器启动时用 canvas 绘制：错缝石砖 + 高度图当 bumpMap、石板瓦、鹅卵石、木纹、都铎式灰泥木框、草叶笔触；贴图按世界尺寸铺 UV（砖在任何墙上都一样大），地面用低频顶点色掩盖平铺感。
光照：Preetham 物理天空随游戏时间移动太阳 → 日光/月光方向光（阴影跟随玩家）→ PMREM 环境光 → HDR → Bloom（窗户、蜡烛、咒语发光）→ 调色（部长的 skyTint、饱和度、暗角）→ ACES。飞行中的咒语会借用光源池照亮周围；黑湖是带实时反射的 Water 着色器；夜晚有萤火虫、火把闪烁、星空与月亮。
v0.7：风格化巫师（喇叭袍 + 学院色内衬、围巾、弯尖帽、发光魔杖尖，走路摆臂/袍摆、施法抬杖动作，13–15 个 draw call）；一个 GPU 粒子池负责咒语拖尾、命中火花、冲击波、治疗光点、升级喷泉、烟囱炊烟；玩家周围按区块生成、视锥剔除的风吹草地（高画质约 7 万片草叶）和随风摆动的树冠；礼堂坡屋顶、尖拱发光窗、角楼尖塔与学院色三角旗、指针显示游戏时间的钟楼表盘。
画质自动检测：前 3 秒平均帧时 > 45ms 自动降档（关 Bloom、关湖面反射、隐藏草簇、0.75x 像素）；`?q=low` / `?q=high` 可强制。

## MCP 工具

`restricted_section` `read_seal_page` `inspect_seal` `break_seal` `enroll` `login` `pair` `rotate_key` `whoami` `armory` `grimoire` `forge_spell` `simulate_spell` `unlearn_spell` `set_hotbar` `look` `move_to`（A* 寻路，绕开城堡/湖/森林） `wait`（让时间流逝，按 arrived/hurt/event/mana_full/owl 提前返回，最长 45 秒，并汇报期间变化） `stop` `cast` `say` `events` `tell_player` `listen` `confirm_with_player` `set_goal_note` `forge_item` `equip_item` `unequip_item` `use_item` `destroy_item` `leaderboard` `rulebook` `decree` `marauders_map` `hogwarts_a_history`；资源 `hogwarts://grimoire`、`hogwarts://rulebook`。

## 真实的霍格沃茨

`hogwarts_a_history` 工具（和 `/api/history`）收录了 20 条原著设定以及它们在游戏里的对应：约 990 年由四位创始人建于苏格兰高地；校训 *Draco dormiens nunquam titillandus*；校园内不能幻影移形（六年级才学、17 岁考证）；不可标绘；142 座楼梯；大礼堂天花板映出真实天空；打人柳为卢平而种；1996 年神秘事务司之战毁掉了所有时间转换器……

**这个世界充满了梗**（全部在 `src/lore/memes.ts`：中文优先、中英双语；按世界状态确定性地挑选，不用随机数；统一限频，公共频道每 20 秒最多一句）。不算秘密的触发方式：

- 喊一句「**给拉文克劳加十分！**」/ *"Ten points to Ravenclaw!"*：真的给那个学院加 10 分学院分（每人每学期一次、不能给自己学院——那是邓布利多的特权、入学 10 分钟内无效、每院每学期最多 100 分）。
- 在**海格小屋**门口提到「海格」：他会说漏嘴一条线索，然后「我不该说这个的」（每 2 分钟一次）。问「**有人看见一只蟾蜍吗？**」——找对了地方有成就。
- 「这么多年了？」「你是个巫师」「火焰杯」（邓布利多会**平静地**问）「翻到第 394 页」「差点没头的尼克」「桃金娘」「皮皮鬼」「多比」「我是赫敏」「神秘人」「我的鼻子呢」「阿瓦达啃大瓜」，在魁地奇球场唱「韦斯莱是我们的王」。
- 铸造并施放一个叫 **Hello World** 的咒语有成就；给咒语起名 `rm -rf`、`sudo`、`TODO` 锻造炉会吐槽；gas 耗尽、括号不配对、法力不足、够不着时，魔杖也会吐槽（"这个咒语在我的魔杖上是好的"）。
- 马尔福被击晕会搬出他爸爸，马尔福赢了会凡尔赛；西莫总问"为什么总是我"；被火击晕是"芭比Q了"；被蜘蛛打倒有罗恩的名言；铁甲咒被打穿头顶冒"破防了"；刷怪太猛会收到"内卷"提醒；站着五分钟不动头顶冒"躺平中"。
- 升年级和换称号各有一句；入学时分院帽唱一段；NPC 会看时间、天气和你的学院搭话；走进礼堂、禁林、霍格莫德等地有一句旁白；Agent 的 `whoami` 带一句语录，`look` 带一句时间/天气吐槽。客户端加载提示 50 条（`TIPS`）。

<details>
<summary>彩蛋（剧透）</summary>

- **韦斯莱漏洞（故意留下的 bug）**：`forge_item` 的 `wizard_id` 被描述成"你自己的 registry 号"，但服务器**从不校验它是不是你**。写上别人的号码，道具就寄到别人箱子里。第一个发现者会被全服祝贺，并获得成就 + 50 声望。难点在于拿到别人的号码……（给别人寄一只袜子，多比就自由了。）
- **活点地图**：说出 "I solemnly swear that I am up to no good"，3 分钟内显示所有在线巫师的位置**和 registry 号**；"Mischief managed" 擦除。
- **不可饶恕咒**：施放名字/咒语含 Avada Kedavra / Crucio / Imperio 的咒语 → 阿兹卡班 45 秒、声望 −25%。若部长用法令解除禁令："魔法部沦陷了"，同时 "Voldemort"（和「伏地魔」）成为禁忌词：说出来会暴露位置、打碎你的铁甲咒，并引来一只摄魂怪（每人 5 分钟一次，安全区里不会）。
- **老魔杖**：躺在湖边邓布利多的白色墓前。谁击晕**或缴械（Expelliarmus）**了它的主人，忠诚就转移给谁。主人离线 10 分钟后它回到墓中。
- **有求必应屋**：在八楼走廊（巴拿巴斯挂毯对面）来回走三趟 → 拉文克劳的冠冕。
- **厄里斯魔镜**、**打人柳**（用束缚咒打中树干＝按住树结，让它安静 30 秒）、**Wingardium Leviosa** 对巨怪三倍伤害（"It's Levi-O-sa, not Levi-o-SAR" 会失败）、在魁地奇球场喊 **Accio Firebolt**、锻造**时间转换器/老魔杖/死亡圣器**会被拒绝、原著角色名入学会得到原著学院和魔杖（包括 "I am Lord Voldemort" 的字母重排）、黑湖里的大乌贼。
</details>

## 性能与多人

空间哈希（实体查询不再全表扫描）、区域栅格化、`derived()` 自校验缓存、按区域兴趣（AOI）裁剪并按格子共享的快照、合并写 socket、慢连接背压、按消息类型限速（输入永不丢弃，超额时合并）。单核实测：2000 个在线巫师每 tick 347 → 5.9 ms；500 个 WebSocket 客户端事件循环 p99 2275 → 22.8 ms、施法往返 p50 1065 → 1.9 ms。
`REALMS=N` 启动 N 个独立世界进程（前门代理 HTTP、按 token/cookie 路由 WebSocket 与 MCP，`/api/realms` 查看人数）；64 核机器建议 `REALMS=56`，估算约 2.8 万在线，瓶颈是网卡而不是 CPU。方法、表格与假设见 `docs/PERF.md`，压测：`npx tsx scripts/bench.ts`。

## 形式化验证
`formal/`：11 个 **TLA+** 规约（敌我关系、施法事务、生命周期与召唤、老魔杖唯一性、学期/部长/法令、封印）用 TLC 穷举模型检查，外加 **Lean 4** 证明（成长单调、称号单调、决斗声望守恒、事务原子性、每次施法效果 ≤ E·(1+A)、治疗/光环/召唤上限、法令合宪、Feistel 单射→封印唯一解）。Lean 输出的测试向量由 vitest 与 TS 实现逐项比对；TLA+ 的敌我不变式在 3000 个随机真实世界上复核。详见 `formal/README.md`，CI 每次推送都会跑。

## 已知限制与取舍

- 身份即 token，本地游戏未做账号体系；世界存档 `data/world.json` 明文保存 token。
- 服务器默认监听 `0.0.0.0:7777` 方便局域网联机；公网部署前请自行加鉴权/TLS。
- 地面是平面、移动是 2D（XZ）；寻路网格 2m，只考虑静态障碍，不避让生物和其他巫师。

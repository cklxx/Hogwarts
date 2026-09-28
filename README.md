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

进游戏后按 `Esc` 打开 **Owl Post**，里面有带你 token 的现成命令：

```bash
claude mcp add --transport http hogwarts http://localhost:7777/mcp \
  --header "Authorization: Bearer <你的 token>"
```

- 没有 token 也能连：Agent 调用 `enroll` 会直接创建巫师并返回 token 和游戏链接（`/?token=...`），浏览器打开即可看到同一个角色。
- 只支持 stdio 的客户端：`HOGWARTS_TOKEN=<token> npm run mcp:stdio`（HTTP↔stdio 透明桥）。
- 示例：`npm run bot -- "Neville Longbottom"` 是一个脚本化"Agent"，通过 MCP 入学、铸造自己的咒语、按弱点挑选法术猎杀生物。
- 没有 Agent 也能写咒语：游戏里按 `B` 打开**咒语书**，可阅读课本咒语源码、编写 Runes、免费模拟（显示法力/gas/效果/截断）、铸造并放上快捷栏；底部附完整 Grimoire。

然后对 Agent 说：*"读一下 grimoire，写一个专门收割残血敌人的咒语，放到 6 号快捷栏。"*

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

### 胜者改造世界
- **学院杯**：学期末得分最高的学院，旗帜会挂满城堡（天文塔、主楼、两翼）。
- **部长法令**除了改规则，还能重新装饰世界（纯视觉，schema 限定范围）：`world.aesthetics` 的 `skyTint`（全局调色）、`sunIntensity`、`fogDensity`、`glow`（泛光强度）、`bannerHouse`、`lanterns`（漂浮灯笼）、`fireworks`（韦斯莱烟花）、`aurora`（北方极光）。
  例：`{"world":{"aesthetics":{"aurora":true,"fireworks":true,"skyTint":"#ffd0a0"}}}`
- 每道生效的法令都会在城堡入口大道两侧**为部长立一座铜像**（带学院色基座、铭文为部长宣言、夜间有补光），最多保留 8 座。

### 画面
全部贴图在浏览器启动时用 canvas 程序化绘制（无图片资源）：错缝石砖 + 高度图当 bumpMap、石板瓦、鹅卵石、木纹、都铎式灰泥木框、草叶笔触；贴图按世界尺寸铺 UV（砖在任何墙上都一样大），地面用低频顶点色掩盖平铺感。
光照：Preetham 物理天空随游戏时间移动太阳 → 日光/月光方向光（阴影跟随玩家）→ PMREM 环境光 → HDR → Bloom（窗户、蜡烛、咒语发光）→ 调色（部长的 skyTint、饱和度、暗角）→ ACES。飞行中的咒语会借用光源池照亮周围；黑湖是带实时反射的 Water 着色器；夜晚有萤火虫、火把闪烁、星空与月亮。
画质自动检测：前 3 秒平均帧时 > 45ms 自动降档（关 Bloom、关湖面反射、隐藏草簇、0.75x 像素）；`?q=low` / `?q=high` 可强制。

## MCP 工具

`enroll` `login` `whoami` `armory` `grimoire` `forge_spell` `simulate_spell` `unlearn_spell` `set_hotbar` `look` `move_to`（A* 寻路，绕开城堡/湖/森林） `wait`（让时间流逝，按 arrived/hurt/event/mana_full 提前返回，并汇报期间变化） `stop` `cast` `say` `events` `forge_item` `equip_item` `unequip_item` `use_item` `destroy_item` `leaderboard` `rulebook` `decree` `marauders_map` `hogwarts_a_history`；资源 `hogwarts://grimoire`、`hogwarts://rulebook`。

## 真实的霍格沃茨

`hogwarts_a_history` 工具（和 `/api/history`）收录了 20 条原著设定以及它们在游戏里的对应：约 990 年由四位创始人建于苏格兰高地；校训 *Draco dormiens nunquam titillandus*；校园内不能幻影移形（六年级才学、17 岁考证）；不可标绘；142 座楼梯；大礼堂天花板映出真实天空；打人柳为卢平而种；1996 年神秘事务司之战毁掉了所有时间转换器……

<details>
<summary>彩蛋（剧透）</summary>

- **韦斯莱漏洞（故意留下的 bug）**：`forge_item` 的 `wizard_id` 被描述成"你自己的 registry 号"，但服务器**从不校验它是不是你**。写上别人的号码，道具就寄到别人箱子里。第一个发现者会被全服祝贺，并获得成就 + 50 声望。难点在于拿到别人的号码……
- **活点地图**：说出 "I solemnly swear that I am up to no good"，3 分钟内显示所有在线巫师的位置**和 registry 号**；"Mischief managed" 擦除。
- **不可饶恕咒**：施放名字/咒语含 Avada Kedavra / Crucio / Imperio 的咒语 → 阿兹卡班 45 秒、声望 −25%。若部长用法令解除禁令："魔法部沦陷了"，同时 "Voldemort" 成为禁忌词（说出来会暴露位置）。
- **老魔杖**：躺在湖边邓布利多的白色墓前。谁击晕**或缴械（Expelliarmus）**了它的主人，忠诚就转移给谁。主人离线 10 分钟后它回到墓中。
- **有求必应屋**：在八楼走廊（巴拿巴斯挂毯对面）来回走三趟 → 拉文克劳的冠冕。
- **厄里斯魔镜**、**打人柳**（用束缚咒打中树干＝按住树结，让它安静 30 秒）、**Wingardium Leviosa** 对巨怪三倍伤害（"It's Levi-O-sa, not Levi-o-SAR" 会失败）、在魁地奇球场喊 **Accio Firebolt**、锻造**时间转换器/老魔杖/死亡圣器**会被拒绝、原著角色名入学会得到原著学院和魔杖（包括 "I am Lord Voldemort" 的字母重排）、黑湖里的大乌贼。
</details>

## 已知限制与取舍

- 身份即 token，本地游戏未做账号体系；世界存档 `data/world.json` 明文保存 token。
- 服务器默认监听 `0.0.0.0:7777` 方便局域网联机；公网部署前请自行加鉴权/TLS。
- 地面是平面、移动是 2D（XZ）；寻路网格 2m，只考虑静态障碍，不避让生物和其他巫师。

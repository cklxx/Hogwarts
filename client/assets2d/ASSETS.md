# 2D 素材清单（assets2d/）— 最终收口版（2026-10-21）

2D 客户端素材只有一个来源：**精灵工厂预渲染产出**（`prerendered/`）。
加载层 `client/client2d/assets.ts` 只加载工厂的 `sprites.json`、PNG 与
`palette.json`，别无第二素材包。尺寸登记唯一口径见
`client/client2d/size-design.md`。

**缺失口径**：工厂精灵缺失的实体**不绘制**，并在 console 打一次警告
（`warnMissingSprite`）。素材缺口必须暴露，不再有代码手绘回退糊住。

## 1. 工厂管线与模型源

管线（`tools/sprite-factory/`）：3D 模型在固定相机（俯角 40°、正南看北）+
固定灯光（半球光 + 带阴影主光 + 补光，ACES）下渲染成透明底 PNG，阴影烘焙
进精灵；全部精灵再过像素化管线：降分辨率（14 px/米，最近邻）+ 主调色板
量化（中位切分 44 色 + 锚点 20 色，共 55 色，写入 `prerendered/palette.json`）
+ 1px 描边（#2a1f1a）。产出 273 个精灵。

| 模型源 | 用途 | License |
|---|---|---|
| Kenney Fantasy Town Kit 2.0 | 房屋零件（墙/屋顶/烟囱/灯柱/栅栏），工厂拼装整房 houseWood/houseStone/houseTavern | **CC0**（`models3d/fantasy-town/License.txt`） |
| Kenney Nature Kit | 树（treePine / treeRound） | **CC0**（`models3d/nature-kit/License.txt`） |
| Kenney Mini Characters | 人物试点 char3d（已被自建巫师替代，仅存档） | **CC0**（`models3d/mini-characters/License.txt`） |
| 工厂自建（基础体拼装） | 全部 `hw-*`：城堡建筑、霍格沃茨专属造型、巫师/教授/海格/摄魂怪/商人/小精灵、34 种生物、道具 | 自建，无外部授权负担 |

来源：https://kenney.nl/assets/fantasy-town-kit 、/nature-kit 、/mini-characters 。
模型原件（仅取用件 + 贴图）存 `models3d/`，整包未入库。

## 2. 最终清单：游戏内可见物 → 来源 → 尺寸登记

尺寸登记位置统一指 `client/client2d/size-design.md` 的章节与 renderer 登记表。

| 类别 | 精灵来源（工厂） | 尺寸登记 |
|---|---|---|
| 地面（草/土路/石板/水面/林地） | tile 网格贴图（renderer 程序生成，与工厂共用 `palette.json`；村庄广场土盘与道路 dirt 在 `buildClassGrid` 分类） | §2（纹理口径 TPX=3，无独立米制） |
| 城堡建筑（礼堂/主楼 keep/东翼/塔楼 3 档/天文塔/城墙/城门/高架桥） | hw-great-hall / hw-keep / hw-tower-short·mid·tall / hw-astro-tower / hw-castle-wall / hw-castle-gate / hw-viaduct | §7 城堡族 |
| 图书馆 / 宿舍塔 / 车站 / 温室 | hw-library / hw-dorm-tower / hw-station / hw-greenhouse | §7 布局族（模型米 × U_STRUCT） |
| 魁地奇看台 / 球门环组 | hw-pitch-stand / hw-quidditch-hoops | §7 |
| 海格小屋 / 打人柳 / 黑湖码头 / 霍格沃茨特快 | hw-hagrid-hut / hw-whomping-willow / hw-lake-dock / hw-express | §7 |
| 霍格莫德命名商店（4 间） | houseTavern（三把扫帚）/ houseStone（猪头酒吧·佐科）/ houseWood（其余） | §7（钉占地宽，系数 1.0） |
| 村庄住宅（茅屋 / 石屋） | houseWood / houseStone | §7 布局族（模型 4.071 米 × U_STRUCT ≈ 13.0s，2026-10-21 并入，取舍见 §4）。注：登记与绘制路径已就绪，但当前布局引擎放置产出为 0 栋（FOOT 碰撞盒与已注册障碍盒冲突，属布局线待修项） |
| 村庄树 / 栅栏 / 路灯 | treePine / treeRound / fence / lamp | §6（树按高登记 13.8）/ §7（路灯 12.6s） |
| 人物（学生 4 学院色 / 教授 / 海格 / 摄魂怪 / 商人 / 家养小精灵 / 猫） | hw-wizard-gryffindor·slytherin·ravenclaw·hufflepuff / hw-professor / hw-hagrid / hw-dementor / hw-merchant / hw-elf / hw-cat，各 4 方向 ×（站立 + 4 行走帧） | §5（renderer `FIGURE_W` / `FIGURE_DH`） |
| 生物（34 种，全物种） | hw-*（renderer `CREATURE_HW` 全映射：spider/aragog/basilisk/hippogriff/troll/dragon/unicorn/phoenix/thestral/kelpie/werewolf/nundu 等） | §8（renderer `CREATURE_HW.wM`） |
| 道具（坩埚 / 南瓜 / 蜡烛 / 宝箱 / 日记 / 扫帚 / 金飞贼 / 鬼飞球 / 药水瓶 3 色 / 曼德拉草 / 魔杖盒 / 柳条断枝 / 栖木猫头鹰） | hw-cauldron / hw-pumpkin / hw-candle / hw-chest / hw-diary / hw-broomstick / hw-snitch / hw-quaffle / hw-potion-red·green·blue / hw-mandrake / hw-wand-box / hw-willow-branch / hw-owl-brown·snowy | §9 |
| 布局装饰（井 / 市场摊 / 村庄门 / 帐篷 / 船 / 灯塔 / 长椅 / 稻草人 / 蜂箱 / 秋千 / 路牌 / 芦苇 / 花坛 / 篝火 / 猫头鹰棚屋 / 记分牌 / 训练环 / 对角巷店铺与酒吧 等） | 站立捕获：`components.ts` 矢量绘制为形状源，捕获后过与工厂同款的像素化 + 主调色板收尾（`pixelateCapture`） | layout2d FOOT × s（各物件布局口径） |

**已知缺口（工厂未建模，按缺失口径不绘制 + 警告）**：

| 缺口 | 触发点 | 说明 |
|---|---|---|
| 火盆 brazier | 布局物件 `brazier`（城堡火盆等） | 原 sprites.ts 手绘已退役；待工厂建模后按 §9 登记补入 |
| 墓碑 tombstone | 大战周墓碑（`snap.warweek.tombstones`） | 同上；当前只显示名字文字 |

## 3. 退役记录

| 退役项 | 日期 | 替代 |
|---|---|---|
| Kenney Tiny Town（2D 像素包） | 2026-10-21 | 村庄地面 → tile 网格地形；房屋/树/栅栏/路灯 → 工厂精灵（houseWood/houseStone/treePine/treeRound/fence/lamp） |
| Kenney Roguelike RPG Pack（2D 像素包） | 2026-10-21 | 火把路灯 → 工厂 lamp 精灵 |
| `client/client2d/sprites.ts`（代码手绘精灵） | 2026-10-21 | 生物/道具全量工厂精灵；brazier/tombstone 转已知缺口 |
| `client/client2d/chars.ts`（代码手绘人物） | 2026-10-21 | 人物全量工厂 hw 精灵；分类逻辑（`variantForName` / `dirFromAngle` / `CharVariant`）迁入 `renderer.ts` |

退役说明：Kenney 2D 像素包目录（`kenney-tiny-town/`、`kenney-roguelike-rpg/`）
已删除；Kenney 的 **3D** 模型包保留在 `models3d/` 供工厂使用，不受影响。
两包均为 CC0，历史 tile 索引与评估记录（Tiny Dungeon / Roguelike Characters
未采用）见 git 历史中的旧版 ASSETS.md。

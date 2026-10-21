# 2D 素材包清单（assets2d/）

2D 客户端自 2026-10-20 起改用 CC0 像素素材包，逐步替代代码手绘。
加载层：`client/client2d/assets.ts`。试点区域：霍格莫德村。

## 1. Kenney Tiny Town（主包）

| 项 | 内容 |
|---|---|
| 来源 | https://kenney.nl/assets/tiny-town |
| 下载 | https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip |
| License | **CC0**（Creative Commons Zero；kenney.nl 页面标注 "CC0 licensed"，Kenney 全部素材均为 CC0，可商用、免署名） |
| Tile | 16×16 px，`tilemap_packed.png` 为 12 列 × 11 行紧凑图集（无间隔），共 132 个 tile |
| 本地文件 | `kenney-tiny-town/tilemap_packed.png`、`kenney-tiny-town/Tilesheet.txt`（官方 tile 说明） |

tile 索引（行主序，index = row×12 + col）：

| 类别 | 索引 |
|---|---|
| 草地 | 0 纯草、1 草变体、2 草+黄花 |
| 土路（3×3 blob） | 12/13/14 上行、24/25/26 中行、36/37/38 下行（25 = 纯土） |
| 沙地 | 39–42 |
| 松树（2 tile 高） | 绿 4+16、橙 3+15；单 tile 小松 28（绿）、27（橙） |
| 圆冠树（2 tile 高） | 5+17；细树变体 6+18、7+19、8+20 |
| 秋色树（3×3） | 9/10/11、21/22/23、33/34/35 |
| 蘑菇 | 29 |
| 栅栏 | 44–47、56–59、68–71、80–82（80/81/82 = 左端/中段/右端横栏） |
| 灰屋顶 | 上行 48/49/50、下行 60/61/62、山墙 63、天窗 51 |
| 红屋顶 | 上行 52/53/54、下行 64/65/66、山墙 67、天窗 55 |
| 抹灰墙 | 72/73 素墙、74 拱门洞、75 墙基、84 窗、85/86/87 门 |
| 石墙 | 76/77/79 素墙、78 拱门洞、88 窗、89/90/91 门 |
| 告示牌 | 83 |
| 城堡墙件 | 96–103、111–114、123–126（未用，备用） |

## 2. Kenney Roguelike RPG Pack（补充包）

| 项 | 内容 |
|---|---|
| 来源 | https://kenney.nl/assets/roguelike-rpg-pack |
| 下载 | https://kenney.nl/media/pages/assets/roguelike-rpg-pack/12c03cd78b-1677697420/kenney_roguelike-rpg-pack.zip |
| License | **CC0**（见本地 `kenney-roguelike-rpg/License.txt`，可商用、免署名） |
| Tile | 16×16 px，tile 间隔 1 px（步距 17），图集 968×526 ≈ 57 列 × 31 行 |
| 本地文件 | `kenney-roguelike-rpg/roguelikeSheet_transparent.png`、`kenney-roguelike-rpg/License.txt` |

已用 tile（col,row）：火把 (18,7) —— 与 Tiny Town 木桩 tile 47 合成村庄火把路灯。
其余内容（水面/草地/石板/木地板/家具/帐篷等）备用，后续区域迁移时取用。

## 3. 评估未采用

| 包 | License | 未采用原因 |
|---|---|---|
| Kenney Tiny Dungeon | CC0 | 人物只有正面单帧，无 4 方向行走帧；地牢题材与村庄不符 |
| Kenney Roguelike Characters | CC0 | 纸娃娃拼装系统，人物为正面单帧，无 4 方向行走帧 |

**人物现状**：两个候选包都没有 4 方向行走动画，采用会让现有人物系统
（`chars.ts`：4 方向 × 行走帧、按学院换袍色）倒退。故第一阶段人物回退代码绘制，
待找到合适的 CC0 4 方向人物包再换。换色管线（`assets.ts` 的 `hueShift`）已打通，
当前用于生成绿色屋顶的商店变体，后续可直接用于人物袍子换色。

## 4. 3 转 2 预渲染管线（2026-10-20 起）

像素素材被否决后改走预渲染路线：3D 模型在固定相机（俯角 40°、正南看北）
+ 固定灯光（半球光 + 带阴影主光 + 补光，ACES）下由 `tools/sprite-factory/`
渲染成透明底 PNG，阴影烘焙进精灵。标准密度 48 px/米，人物 144 px/米。
产出在 `prerendered/`（PNG + sprites.json 锚点/占地），`assets.ts` 独立加载，
失败时渲染器回退像素素材/代码绘制。

| 包 | 用途 | License |
|---|---|---|
| Kenney Fantasy Town Kit 2.0 | 房屋零件（墙/屋顶/烟囱/灯柱/栅栏），工厂拼装整房 | **CC0**（`models3d/fantasy-town/License.txt`） |
| Kenney Nature Kit | 树（tree_pineTallA / tree_tall） | **CC0**（`models3d/nature-kit/License.txt`） |
| Kenney Mini Characters | 人物试点（character-male-a，自带 walk/idle 动画） | **CC0**（`models3d/mini-characters/License.txt`） |

来源：https://kenney.nl/assets/fantasy-town-kit 、/nature-kit 、/mini-characters 。
模型原件（仅取用件 + 贴图）存 `models3d/`，整包未入库。

已产出精灵：房屋 3 变体（木屋 houseWood / 石屋 houseStone / 高顶酒馆
houseTavern）、松树、圆冠树、路灯、栅栏、人物 4 方向 ×（站立 + 4 帧行走）。

**缺口清单**：

| 缺口 | 说明 |
|---|---|
| 其余村庄物件 | 长椅、招牌、马车等未建 |

**2026-10-21 更新**：巫师人物与霍格沃茨专属建筑已在工厂内用基础体拼装自建，
不再依赖外部模型包。新增 62 个 `hw-*` 精灵（城堡塔楼 3 高度/礼堂/温室/天文塔/
城门、海格小屋/打人柳/魁地奇球门/特快车头/码头、巫师 4 学院色+教授+海格+
摄魂怪各 4 方向、猫头鹰/蜘蛛/蛇怪/鹰头马身有翼兽/猫、坩埚/扫帚/药水瓶等道具、
曼德拉草/魔鬼网/柳枝），清单与建模方案见
`~/workspace/goals/2d/hidden_files/prerender-v2/catalog.md`。精灵总数 89。

**2026-10-21 第二批 + 像素化更新**：

- 补齐城堡主体：`hw-keep`（主楼+东翼复用）、`hw-library`、`hw-dorm-tower`、
  `hw-pitch-stand`、`hw-station`、`hw-viaduct`，渲染器已接线替换代码绘制。
- 生物全覆盖：`CREATURE_HW` 映射 34 种（30 野生 + 召唤 serpent/birds +
  owl/cat），新增 26 个模型（pixie/troll/unicorn/dragon/phoenix/thestral/
  niffler/kelpie/werewolf/nundu 等），无物种再走代码绘制。
- 人物补齐：`hw-merchant`、`hw-elf`（各 4 方向 × 站立+4 行走帧）。
- 弱项返工：`hw-express` 加一节车厢+蒸汽+烟囱；`hw-hippogriff` 翅膀收拢站立。
- **像素化管线**（`tools/sprite-factory/factory.js`）：全部精灵渲染后统一过
  降分辨率（14 px/米，最近邻）+ 主调色板量化（中位切分 44 色 + 锚点 20 色，
  共 55 色，写入 `prerendered/palette.json`）+ 1px 描边（#2a1f1a）。
  参数写入每条精灵的 `sprites.json` 的 `pix` 字段。精灵总数 273。
- **地面像素化**（`renderer.ts`）：与精灵共用同一调色板程序生成可平铺贴图
  （草地/禁林地/石板/水面四种区域底图，土路 kind 已备未启用，256 格/片，噪点+草叶像素簇），区域底图改用
  贴图填充；烘焙末尾整图过马赛克（2 纹理px/格）+ 调色板量化；水面波光帧同步
  量化；全部 hw 精灵与地面绘制关闭平滑缩放。

**残留代码手绘清单**（目标：只剩地面细节与个别小物）：

| 残留 | 位置 | 说明 |
|---|---|---|
| 地面细节 | renderer.ts 各 TEX_PAINT / paintDecorations | 路径、球场条纹、庭院、蛛网等：烘焙后统一过马赛克+量化，视觉已并入像素风，保留矢量绘制作为形状来源 |
| 城堡围墙/庭院 | paintCastle | hw 建筑覆盖主体，围墙带与庭院地面仍代码绘制（同上，已过像素收尾） |
| 回退路径 | sprites.ts / chars.ts | 仅在 hw 精灵未加载时启用；全部物种/人物已有 hw 映射，正常运行时不触发 |
| 村庄房屋 | paintVillageAssets | Kenney 预渲染房屋（非 hw 工厂），已随地面收尾过量化 |


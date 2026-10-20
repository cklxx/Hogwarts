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

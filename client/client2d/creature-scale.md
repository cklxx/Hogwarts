# 生物体型表（2D 客户端）

> **口径已迁移（统一尺寸系统）**：绘制不再用本表的 hM×20 口径。
> 现行规则见 `size-design.md`：生物按登记世界宽度 `wM` 绘制
> （renderer `CREATURE_HW.wM`），真实 W×D×H 与 wM 全表在 size-design.md
> 第 8 节。本表保留身高依据（原著量级）作为 size-design 的数据来源。

**标定基准（旧口径，存档）**

| 项 | 值 |
|---|---|
| 换算 | 1 米 = 20 × cam.zoom 屏幕 px（`ENTITY_PX_PER_M`） |
| 标定来源 | 巫师身高 1.8 米，绘制高 36 × cam.zoom |
| 定尺寸维度 | 精灵绘制高度。宽度按精灵宽高比自动跟随 |
| 脚下落点 | 精灵锚点落在位置点下方绘制高的一半。与巫师同口径 |

**旧口径的问题**

旧口径按宽度乘系数定尺寸。窄高精灵被放大：独角兽精灵 22×41，旧绘制高 266 px（2.75 倍缩放）。宽扁精灵被压小：蜘蛛精灵 52×22，旧绘制高 22 px。本表改按高度定尺寸，两类问题同时消除。

**体型表**

身高 = 精灵绘制高度（米）。宽度由宽高比决定，本表列出计算值供核对。

| 物种 | 精灵 | 身高（米） | 宽度（米） | 依据 |
|---|---|---|---|---|
| troll 巨怪 | hw-troll | 3.5 | 4.97 | 山地巨怪约 3.5 米 |
| aragog 阿拉戈克 | hw-spider | 1.3 | 3.07 | 腿展约 3 米 |
| dragon 幼龙 | hw-dragon | 2.5 | 2.85 | 幼龙量级 |
| nundu 囊毒豹 | hw-nundu | 2.6 | 1.58 | 大象量级 |
| hippogriff 鹰头马身有翼兽 | hw-hippogriff | 2.4 | 2.72 | 站立高度 |
| dementor 摄魂怪 | hw-dementor-down | 2.4 | 1.80 | 高大漂浮人形 |
| basilisk 蛇怪 | hw-basilisk | 2.2 | 1.77 | 立起部分 |
| werewolf 狼人 | hw-werewolf | 2.1 | 1.62 | 直立人形 |
| chimera 客迈拉 | hw-chimera | 2.1 | 1.12 | 狮身量级 |
| manticore 人头狮身蝎尾兽 | hw-manticore | 2.0 | 1.07 | 狮身量级 |
| thestral 夜骐 | hw-thestral | 1.8 | 1.71 | 马形 |
| inferius 阴尸 | hw-inferius | 1.75 | 1.75 | 人形 |
| boggart 博格特 | hw-boggart | 1.7 | 1.89 | 人形量级 |
| kelpie 马形水怪 | hw-kelpie | 1.7 | 0.91 | 马形 |
| unicorn 独角兽 | hw-unicorn | 1.6 | 0.86 | 马形 |
| thunderbird 雷鸟 | hw-thunderbird | 1.5 | 3.75 | 翼展自动值 |
| snare 魔鬼网 | hw-devils-snare | 1.1 | 2.01 | 贴地藤蔓团 |
| occamy 鸟蛇 | hw-occamy | 1.1 | 1.48 | 有翼蛇形 |
| skrewt 炸尾螺 | hw-skrewt | 1.0 | 0.79 | 大型甲壳 |
| serpent 召唤蛇 | hw-serpent | 1.0 | 0.79 | 立起部分 |
| runespoor 如尼纹蛇 | hw-runespoor | 0.9 | 1.15 | 三头蛇，贴地 |
| erkling 小妖精 | hw-erkling | 0.9 | 1.30 | 小型人形 |
| spider 八眼巨蛛 | hw-spider | 0.8 | 1.89 | 腿展自动值 |
| grindylow 格林迪洛 | hw-grindylow | 0.8 | 1.11 | 水生小型 |
| birds 召唤鸟群 | hw-birds | 0.8 | 1.43 | 一群鸟的整体 |
| redcap 红帽子 | hw-redcap | 0.6 | 0.78 | 矮人形 |
| phoenix 凤凰 | hw-phoenix | 0.6 | 1.33 | 翼展自动值 |
| hinkypunk 欣克庞克 | hw-hinkypunk | 0.55 | 0.66 | 单腿小怪 |
| owl 猫头鹰 | hw-owl-brown | 0.5 | 0.81 | 站立高度 |
| lethifold 伏地蝠 | hw-lethifold | 0.5 | 0.77 | 贴地斗篷，厚度 |
| pixie 康沃尔郡小仙子 | hw-pixie | 0.4 | 0.80 | 翼展自动值 |
| cat 猫 | hw-cat | 0.4 | 0.28 | 站立高度 |
| niffler 嗅嗅 | hw-niffler | 0.35 | 0.27 | 小型 |
| bowtruckle 护树罗锅 | hw-bowtruckle | 0.3 | 0.38 | 昆虫量级 |

**核验方法**

打开 `/lineup.html`（vite 开发服务）。页面按本表把每种生物与 1.8 米巫师并排绘制在同一地面线，附 1 米刻度。目视核对比例。

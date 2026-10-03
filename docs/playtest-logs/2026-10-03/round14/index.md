# 第 14 轮：桌面交互提示纸底

日期：2026-10-03。基线 `main 1b6b069`，产品修复 `8425ea1`，分支 `codex/desktop-prompt-paper`。本轮接续第 13 轮桌面待办。

将手机已采用的 `border-image-source:none` 和 `border-color:var(--paper2)` 移入共享 `#prompt`，删除手机重复覆盖。桌面提示从 SVG 撕边变为主题色直边；7px 边框占位、纹理、阴影、浮动动画、文字和交互保留。

## 固定布局缺陷与生产 CSS 验证

使用[第 13 轮夹具](../round13/layout/prompt-fixture.mjs)，读取真实 HTML/CSS/字体，移除游戏脚本；不运行世界或 WebGL。900×600 中文、ANGLE/SwiftShader 下，短文案变长后背景主体缺失，提示文字落到深色背景。默认启动参数及英文对照正常。

| 同条件内部横向扫描线 | 基线 | 最终生产 CSS |
|---|---:|---:|
| 900px 中文 SwiftShader 浅纸像素 | 0/218 | 196/218 |
| 900px 中文默认参数浅纸像素 | 196/218 | 196/218 |

扫描 y=round(top+11)，x=round(left+14)..round(right−14)−1，浅纸条件 R>140 且 G>100；文字和纹理会减少计数。这是缺底诊断，不是 WCAG 对比度或性能数据。[像素检查脚本](verify-paint.mjs) 在基线 4 例中报 1 个绘制失败，在最终 16 例中报 0 个失败。

基线截图：[缺底夹具](screenshots/fixture-before-900-zh.png)；最终：[完整纸底夹具](screenshots/fixture-after-900-zh.png)。4 组 900px 前后提示宽高一致。

最终 16 例覆盖 320/390px 手机、900/1280px 桌面 × 中英 × 默认/SwiftShader；每例短→长→隐藏再显示→点击。全部文字无裁切、点击通过、pageerror 为空，长提示和重新显示的浅纸扫描比例均 ≥80%。另外 900px 中文/英文夜读、高对比各 2 例通过，主题墨色与纸边正确；夜读以目检和样式检查验证，不套用浅纸阈值。[夜读截图](screenshots/night-zh.png)、[高对比截图](screenshots/contrast-zh.png)。

紧凑原始数据：[基线](before-paint.json)、[最终 16 例](after-paint.json)、[夜读](night-paint.json)、[高对比](contrast-paint.json)。基线首次安装浏览器工具时 npm 解析到 Vite 8.3.2；最终恢复 `npm ci` 的 Vite 8.3.1 后重跑全部 20 例。修复 CSS 在两次构建中逐字节相同，最终 `shared-BMrym7g0.css` SHA-256 为 `3d5d7652139e74043371576a559fdf5cee76b4464f55f85cfb6931e352ad5bb1`。

## 实际游戏回归

900×600、DPR1、Chromium ANGLE/SwiftShader，生产服务器原样加载；无资源拦截、临时 CSS 或游戏状态修改。角色从真实 UI 入学，MCP 使用同角色正常 `move_to`/`wait` 寻路；英文通过菜单的语言按钮切换。

**本轮中文真实游戏基线没有复现缺底**：[基线返回截图](screenshots/game-before-zh.png)、[记录](game-before-zh.json)。此结果与固定布局夹具的失败分别报告，不将夹具失败称为本轮实际游戏失败。

最终锁定依赖构建下，中英文两路均验证初载完整纸底、F 键打开五目的地列表、Cancel 关闭、正常离开壁炉后提示隐藏、返回后完整重显、鼠标点击提示打开菜单和 Esc 关闭。所有三段正常寻路均返回 arrived，pageerror 为空。目的地列表不等于五次旅行成功，本轮没有执行旅行。

- 中文同角色：[最终返回截图](screenshots/game-after-zh.png)、[完整操作记录](game-after-zh.json)。
- 英文新角色：[最终返回截图](screenshots/game-after-en.png)、[完整操作记录](game-after-en.json)。
- [可复用游戏回归脚本](game-regression.mjs)。`PRIVATE_STATE` 包含密钥，只保存到仓库外的私有文件，不归档。

## 工程检查与重跑

恢复锁定依赖后：`npm run typecheck` 通过；`npm test -- --maxWorkers=2` 为 **80 文件、813 项通过**；`npm run build` 通过（Vite 8.3.1）。只有客户端 CSS 和验证文档变动；无内核规则或形式化源码变动。尚未取得远程 CI 结果。

```bash
npm ci
npm run build
npm install --prefix /tmp/hogwarts-browser playwright-core pngjs
FIXTURE_ROOT="$PWD" FIXTURE_OUT=/tmp/desktop-prompt FIXTURE_BUILT=1 \
  FIXTURE_MODE=after FIXTURE_WIDTHS=320,390,900,1280 \
  PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
  node docs/playtest-logs/2026-10-03/round13/layout/prompt-fixture.mjs
PNGJS=/tmp/hogwarts-browser/node_modules/pngjs/lib/png.js \
  node docs/playtest-logs/2026-10-03/round14/verify-paint.mjs /tmp/desktop-prompt after

# 已启动本地生产服务器时；两个语言各运行一次，保持 PRIVATE_STATE 在仓库外。
PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
  PRIVATE_STATE=/tmp/desktop-private-zh.json SCREEN_OUT=/tmp/desktop-game-zh \
  LANG0=zh MODE=after node docs/playtest-logs/2026-10-03/round14/game-regression.mjs
```

本轮确认软件渲染固定布局的兼容修复和真实游戏操作回归，不确定 Chromium 内部根因，不替代物理手机触控、真人趣味性或 GPU 帧时间验证，不声明性能收益。

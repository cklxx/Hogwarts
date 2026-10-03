# 第 13 轮：打包 CSS 回归与中间失败

最终远程实现 `6b20ea2`（根提交 `efb9527`、开发提交 `7cd61eb` 产品代码树相同）使用 `border-image-source: none`，生产构建完整保留该声明。手机交互提示采用矩形纸色边框；7px 布局边框、背景纹理、阴影、动画、transform、文字与操作不变，桌面保留撕边。

**这是打包 CSS 的 DOM 夹具，不是实际游戏。** 脚本读取 `dist/index.html` 与打包样式，移除脚本和 modulepreload，不启动世界/WebGL；不注入候选修复规则。原始 CSS 和最终打包 CSS 的结果分开保留。

## 最终打包夹具

- [最终报告及历史说明](layout/report.txt)
- [打包 CSS 紧凑结果](layout/built-summary.json)：1 例失败产物、12 例最终 after、夜间/高对比各 1 例，共 15 条；12 组几何对照使用原始基线与最终打包 after。
- [失败打包 CSS：320px 英文](layout/built-before-swiftshader-320-en-long.png)、[最终打包 CSS：320px 英文](layout/built-after-swiftshader-320-en-long.png)
- [支持 dist 的可复用脚本](layout/prompt-fixture.mjs)

after 12 例覆盖320/390px手机与900px桌面、中英文、默认flags与ANGLE SwiftShader，每例短→长→隐藏两帧→重新显示→坐标触摸。手机8例长/重新显示纸底完整；所有12例无文字裁切/pageerror，夹具点击全部到达，x/宽/高与基线不变。英文320长标签扫描由失败产物129/290变为267/290；重新显示269/290。扫描不是对比度评分，点击只证明夹具事件到达，不代表服务器旅行成功。

额外夜间与高对比各1例保持主题文字与纸色、无裁切且点击成功；夜间不使用浅像素阈值。桌面4组装饰保留，原桌面SwiftShader中文缺底仍在范围外。精选两图逐张人工查看安全，未将软件渲染结果推广为真机GPU或性能收益。

## 首次生产失败仍保留

中间远程 `cef328c` 的 shorthand `border-image: none` 在源码夹具通过，却被压缩器变成空 `border-image:`，真实生产页面仍使用edge.svg并缺底。此反例促成longhand修正与dist夹具，不能将初次源码成功写为产品成功。

[失败浏览器指标](build-failure/metrics.json)、[失败CSS片段](build-failure/compiled-css.txt)、[完整失败CSS供复现](build-failure/failed-production.css)。历史源码夹具保留[汇总](layout/summary.json)、[before](layout/before.json)、[after](layout/after.json)、[夜间](layout/night.json)、[高对比](layout/contrast.json)；它们仅是中间源码结果，旧after图片不再作为最终图。

## 重跑

先在目标仓库执行 `npx vite build`，再从根目录运行：

```bash
FIXTURE_ROOT="$PWD" \
FIXTURE_OUT=/tmp/floo-built-repro \
FIXTURE_BUILT=1 \
FIXTURE_MODE=built-after \
PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
CHROMIUM=/usr/bin/chromium \
node docs/playtest-logs/2026-10-03/round13/layout/prompt-fixture.mjs
```

复现失败产物时增加 `FIXTURE_CSS="$PWD/docs/playtest-logs/2026-10-03/round13/build-failure/failed-production.css"`，并设 `FIXTURE_PROFILES=swiftshader FIXTURE_WIDTHS=320 FIXTURE_LANGS=en FIXTURE_MODE=built-before`、独立输出目录。`FIXTURE_THEME` 指定主题；移除`FIXTURE_BUILT=1`可读取原始CSS。

脚本生成原始几何和截图；像素汇总由原测试者另采样。归档仅做语法/数据形状检查，没有重跑浏览器。最终生产游戏回归见独立[英文](english.md)与[中文](chinese.md)报告，不能把本DOM图当作游戏画面。

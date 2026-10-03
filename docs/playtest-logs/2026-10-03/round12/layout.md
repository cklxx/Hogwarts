# 第 12 轮：符文装备名称布局夹具

基线 `a2b548c`；远程实现 `d3afe89`（根分支 `423839e`、开发提交 `09785bc` 代码树相同）。**纯 DOM 夹具，不是真实游玩**：实际页面、CSS、字体、教程和符文卡代码配合模拟世界输入与 142px 底栏；不连接 WebSocket、不运行 WebGL。点击只证明发送对应装备消息，不证明服务器接受装备。

- [方法与结果报告](layout/report.txt)
- [before 明细](layout/before.json)、[after 明细](layout/after.json)；[before 摘要](layout/before-summary.json)、[after 摘要](layout/after-summary.json)
- [桌面 before](layout/desktop-before.json)、[桌面 after](layout/desktop-after.json)
- [可复用脚本](layout/rune-labels-fixture.mjs)

80 组覆盖 5 种手机尺寸、中英文、标准/长名称、代码展开/折叠、有/无教程。240 个标签中裁切由 176 个降至 0；after 的滚动后不可读、小于 44×44 的手机按钮、重叠、不稳定、错误装备消息及 pageerror 均为 0。归档时重算病例数和裁切数量，结果一致。JSON 仅压缩空白，保留原始字段；详细字符 Range 仅在部分 before 失败例保留。

最短屏 320×568 的卡片可视窗仅 84px，高于该窗口的 40 字长名需要滚动逐段阅读，不能声称同时全部可见。桌面 900×600 中英文两例的卡片与按钮矩形逐项未变；桌面原按钮高度 28.1875px，44px 结论仅适用于手机。

## 精选截图

三张截图归档前均已逐张人工查看，无凭证或配对码。按钮灰色是夹具点击后的 disabled，蓝色是触摸高亮。

- [320×844 英文标准名 before](layout/before-320x844-en-standard-code.png)
- [320×844 英文标准名 after](layout/after-320x844-en-standard-code.png)
- [320×640 英文长名 after，滚动可视位置](layout/after-320x640-en-long-code.png)

## 重跑

在目标版本仓库安装依赖，准备 playwright-core 与 Chromium 后，从仓库根目录运行：

```bash
FIXTURE_ROOT="$PWD" \
FIXTURE_OUT=/tmp/rune-layout-rerun \
FIXTURE_MODE=after \
PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
CHROMIUM=/usr/bin/chromium \
node docs/playtest-logs/2026-10-03/round12/layout/rune-labels-fixture.mjs
```

桌面抽查增加 `FIXTURE_DESKTOP=1`；before 测量将 `FIXTURE_ROOT` 指向安装依赖的基线检出，且改用独立 `FIXTURE_OUT` 与 `FIXTURE_MODE=before`。归档未重跑浏览器矩阵，仅检查现有输出与脚本语法。本轮不宣称性能收益。

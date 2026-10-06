# 第 11 轮：教程 DOM 布局夹具

**这是纯 DOM 布局夹具，不是真实游玩。** 使用实际 HTML、CSS、字体、教程和符文卡代码，但模拟世界输入、教程状态和 142px 底栏；关闭动画，不连接 WebSocket、不运行 WebGL 或战斗。基线为 `4c59861`，远程实现提交为 `8798750`（实测本地整合 `ae8f3df` 与其代码树相同）。

- [测试报告](layout/report.txt)
- [逐例原始 JSON](layout/tutorial-after.json)
- [复用脚本](layout/tutorial-fixture.mjs)
- [320×640 英文教程与展开符文卡截图](layout/tutorial-after-320-en-code.png)

归档时重新汇总原始 JSON：296 组；32 次结束提示关闭成功；72 次展开卡滚动后发送对应装备消息；正文裁切、核心操作区重叠、符文卡重叠、菜单重叠均为 0；全部教程按钮至少 44×44；各例末 3 帧尺寸稳定。这些结果只覆盖夹具输入与默认字号，不能替代实际手机路径回归，也不证明服务器接受了装备请求。

截图已人工查看：画面是夹具布局，没有真实登录凭证或配对码。原脚本在同一路径先后保存两种 320px 高度的图片，归档图片是最后保存的 320×640 版本。

## 重跑

先在目标版本仓库安装依赖，并准备 playwright-core 与 Chromium；脚本不会启动游戏。以目标仓库根目录为当前目录：

```bash
FIXTURE_ROOT="$PWD" \
PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
CHROMIUM=/usr/bin/chromium \
FIXTURE_MODE=after \
FIXTURE_OUT=/tmp/hogwarts-tutorial-layout-rerun \
node docs/playtest-logs/2026-10-03/round11/layout/tutorial-fixture.mjs
```

`FIXTURE_ROOT` 选择被测源代码与该仓库的 TypeScript 依赖，`PLAYWRIGHT_CORE` 为 Playwright 模块文件路径，`CHROMIUM` 为浏览器可执行文件。归档脚本仅将原始运行脚本的机器绝对路径替换为这些可配置路径，并让截图文件名包含高度以避免覆盖；未改变测试流程。归档过程只汇总既有 JSON 并做语法检查，没有重新执行全部浏览器矩阵。

# 第 13 轮：Floo 背景必要因子对照

本轮产品基线为 `34c8837`。**以下为纯 DOM 诊断，不是最终产品 after，也不是真实游戏操作。** 使用实际页面 HTML/CSS/字体，移除游戏入口，不启动世界或 WebGL；匹配 Chromium ANGLE SwiftShader 参数。覆盖样式在首次显示前生效，短提示 164.96875px 变成长提示 317.828125px，保留原动画、transform、边框宽度与 padding。

## 16 例必要因子矩阵

[紧凑原始摘要](causal/paint-matrix.json)：320/390px × border-image 开/关 × 阴影开/关 × 原纹理/纯色背景。

- border-image 开启的 8 例均缺失主体背景；320px 可缺半幅或整幅，390px 整幅缺失。
- border-image 关闭的 8 例均恢复主体背景；阴影与背景纹理的开关不改变此分组。
- 元素几何保持 317.828125×46.5625px，恢复并非扩宽造成。

在这套固定软件渲染与布局条件下，border-image 是异常出现的必要装饰因素，移除它足以恢复。此结果没有确定 Chromium 内部缺陷原因，也未证明物理手机/GPU 普遍表现。去掉 border-image 会失去撕纸边装饰，需要单独确认产品视觉取舍与实际游戏表现。

像素摘要在提示框顶部下 11px 横向采样，排除左右 14px，以 R>140/G>100 统计浅底像素；恢复组约 269/290，失败组为 0 或 127–129/290。文字与纹理会减少计数，该值不是对比度分数，不能脱离截图理解。归档时确认 16 例及开关各 8 例；本步骤没有重新运行浏览器。

## 未采用的保留撕边方案

repeat 模式报告：320/390px × stretch/repeat/space 在 SwiftShader 下 6 例均未恢复，默认 flags 下 6 例正常；异常不只发生在 round 平铺。此处保留执行 Agent 结论，不重复归档全部探索图。

常驻伪元素承载纸边也未解决：320/390px 的短→长及隐藏→显示后仍缺背景，390px 部分情况连文字也被遮；默认 flags 正常，几何不变，点击 8/8 成功。参见 [SwiftShader 紧凑记录](causal/pseudo-swiftshader.json)与[默认 flags 对照](causal/pseudo-default.json)。这些是失败诊断，不是产品 after。

## 最小复现

[已执行脚本](causal/paint-fixture.mjs) 支持仓库、输出、浏览器及 Playwright 路径。目标检出需保留原提示边框，建议使用基线 `34c8837`。在仓库根目录：

```bash
FIXTURE_ROOT="$PWD" \
FIXTURE_OUT=/tmp/floo-paint-repro \
PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
CHROMIUM=/usr/bin/chromium \
PROFILE=swiftshader \
node docs/playtest-logs/2026-10-03/round13/causal/paint-fixture.mjs
```

`PROFILE=default` 对照默认启动参数。脚本生成截图和几何 metrics；上面的浅色像素摘要由原测试者另采样，不由该脚本自动重建。归档仅做脚本语法检查，不重复运行矩阵。本轮不宣称性能收益。

## 产品验证状态

首个实现 `cef328c` 原始 CSS 夹具通过，但生产压缩构建使 shorthand 失效，实际游戏仍缺底；见[构建差异](layout.md)。最终longhand实现 `6b20ea2` 已补打包 CSS 验证。本因果材料不是产品通过证明。

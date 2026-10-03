# 第 12 轮独立调查：Floo 提示半幅背景的临时 CSS 诊断

2026-10-03，这轮实验未修改产品源码；测试页面来自符文标签修复版本 `d3afe89`。原角色NarrowRowanTwelve保存的context重新打开，驻足礼堂，320×844、Chromium ANGLE SwiftShader触屏仿真。此为诊断，所有变体仅暂时改变DOM样式，不写入tracked源码或游戏状态；最终reload恢复并关闭浏览器。

## 结果

| 变体 | 背景表现 | 尺寸 | 安全证据 |
|---|---|---|---|
| 原始auto宽度，fresh reopen/reload | 右半透明、英文低对比 | 317.828125×46.5625 | [s204.png](floo-diagnostic/baseline-auto.png) |
| 仅设置width=offsetWidth+'px' | 整块羊皮纸背景恢复、英文可读 | 318×46.5625 | [s202.png](floo-diagnostic/temporary-width318.png) |
| reload恢复后，仅background-color:var(--paper) | 仍半幅透明 | 317.828125×46.5625 | [s205.png](floo-diagnostic/temporary-paper-color.png) |
| fresh reopen恢复后，仅width:max-content | 仍半幅透明，稳定截图同样 | 317.828125×46.5625 | [s303.png](floo-diagnostic/temporary-max-content.png) |

除单项属性外，原transform/animation/纹理层保持不变。显式318px仅是诊断线索，不能把硬编码固定宽度当成可自适应的生产修复。max-content失败不支持直接用该CSS修复。背景色补底的computed实际已变rgb(242,230,201)，但渲染仍失败。

## 完整computed基线

- backgroundSize auto,auto,auto；Origin/Clip padding-box三层；Repeat repeat三层；Attachment scroll三层。
- 两SVG噪声+radial-gradient羊皮纸；backgroundColor transparent。
- boxSizing border-box；padding 3px 16px 3px 6px；border 7px transparent。
- opacity1/filter none/z-index3/mixBlendMode normal。
- 左右elementsFromPoint均prompt→canvas→body→html，无其他DOM挡住右半。
- first startup s201/s301截到淡出入场遮罩，不选为公开before；s204是无遮挡baseline，s303是max-content稳定截图。

## 文件

本归档仅选择上表四张图片，已逐张人工查看。独立安全记录 [metrics.json](floo-diagnostic/metrics.json) 包含完整 background computed 和各 variant 前后 style/rect；JSON 仅压缩空白，未改变字段。

浏览器已关闭并私有保存角色context；context不属于安全归档，禁止复制。CSS临时样式最后通过reload清除。

## 限制

该问题在指定软件渲染路径真实复现，不推断真实GPU/物理手机普遍存在。每次截图需要数秒，指标与图来自连续调用而非冻结同一渲染帧。没有改变游戏状态或冻结world。后续纯DOM细化由ice_review继续，以区分分数宽度、特定宽度范围与合成层原因。

## 最终收口：未修复

未找到稳定的纯 CSS 修法，本轮产品仍只交付符文名称修复。独立纯 DOM 实验移除游戏入口，不运行世界或 WebGL，在匹配的 ANGLE SwiftShader 参数下也复现缺底；默认浏览器 flags 的完整背景不能否定该现象。证据仅提示软件渲染/合成路径、亚像素宽度与绘制历史相关，没有确定 Chrome 内部根因。

- [纯 DOM 最终报告](floo-diagnostic/fixture-report.txt)
- [紧凑实验摘要](floo-diagnostic/fixture-summary.json)
- [390px：初始常驻 will-change 后短文变长仍缺底](floo-diagnostic/fixture-390-static-will-change-fails.png)
- [320px：初始常驻 will-change 与关闭 bob 动画组合仍缺半底](floo-diagnostic/fixture-320-static-no-animation-fails.png)

两张新增反例已逐张人工查看。长标签绘制后临时加 `will-change: transform` 或临时关闭动画的组合曾看似恢复，但初始常驻样式经过标签变化仍失败，不能当作可部署方案。`animation: none` / `translate: none` 单独或常驻组合均未稳定解决；分数宽度 `317.828125px` 也未解决。没有将固定 `318px` 或 JS 测宽补丁写进产品。

摘要里的浅色像素计数不是对比度分数：仅在提示框顶部下 11px 的横线上排除左右 14px，统计 R>140 且 G>100；文字和纹理会降低计数，必须结合截图解读。未将软件渲染结果推广为物理手机/GPU 结论，也不声称性能收益。

## 重跑纯 DOM 反例

归档脚本仅把已执行脚本的机器路径改为可配置参数，未修改实验流程；归档时只做语法检查，没有重跑浏览器实验。依赖目标仓库的 HTML/CSS/字体、playwright-core 和 Chromium。仓库根目录运行：

```bash
FIXTURE_ROOT="$PWD" \
FIXTURE_OUT=/tmp/floo-layer-repro \
PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
CHROMIUM=/usr/bin/chromium \
PROFILE=swiftshader \
node docs/playtest-logs/2026-10-03/round12/floo-diagnostic/layer-fixture.mjs
```

[初始层提示脚本](floo-diagnostic/layer-fixture.mjs) 对照原样与常驻 will-change，覆盖 320/390px；`PROFILE=default` 可对照默认启动参数。[关闭动画脚本](floo-diagnostic/final-fixture.mjs) 测最后八种宽度/常驻或临时组合，用同样参数并改 `FIXTURE_OUT` 与脚本路径即可。脚本生成截图和几何 metrics；归档中的像素摘要由原测试者另行从截图采样，脚本不会自行重建该摘要。

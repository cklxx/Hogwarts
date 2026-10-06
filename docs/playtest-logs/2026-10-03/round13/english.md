# 第 13 轮：英文 Floo 实际游戏回归

最终远程实现 `6b20ea2`（本地 `efb9527`）；中间失败版本为 `cef328c`（本地 `b93393e`）。本报告保留三个阶段的界限，仅第三阶段为最终生产 after。

## 阶段一：初始CSS资源拦截候选诊断（不是产品after）

角色NarrowRowanTwelve沿用私有context，320×844、DPR1、Chromium ANGLE SwiftShader移动触屏仿真。没有改游戏state、world或localStorage；本阶段通过Playwright拦截CSS资源、在初始加载前附加局部规则，避免把加载后偶然重绘当作修复。

- 原始build baseline/s002.png：稳定半幅底色，右半长英文低对比。
- 初始`#prompt{border-image:none}`：no-border/s002.png全底，原纹理/透明底色/浮动动画保持。真实移动离开火炉后prompt隐藏；正常返回no-border/s012.png再次全底全文可读。移动包含触摸摇杆/地面与键盘W/S纠正站位，没有修改位置。
- 初始`body.phone #prompt{border-image:none;border-color:var(--paper2)}`：paper-border/s002.png全底+纸色边，英文完整。
- 三者prompt bbox均宽317.828125、高46.5625；边框仍7px，候选只把原透明边色改为rgb(231,212,168)，will-change保持auto、背景纹理与transform保持不变。
- 原生手掌`#tb-act`真实触摸打开5目的地Floo菜单（paper-border/s003），真实Cancel关闭（s004）。尝试直接locator.tap浮动prompt会因动画持续变化、无法stable而超时，未把此自动化限制冒充游戏失效。
- 无JS pageerror；只见KHR_parallel_shader_compile软件渲染警告。
- 已关闭浏览器释放CPU给全套checks；等待生产build后无拦截回归。

本归档不复制阶段一候选拦截图及诊断指标，文字保留测试过程。私有context不属于证据，禁止归档。截图和指标是连续调用而非冻结同一帧；测试为触屏仿真，不是物理手机，不报告硬件FPS。

## 阶段二：b93393e生产build无拦截回归——失败并定位构建问题

使用production参数运行，条件不匹配任何page.route分支，未设置临时DOM CSS。production/s002.png仍半幅底色。computed border-color已是paper2，但borderImageSource仍edge.svg。只读检查dist/assets/*.css发现生成规则`body.phone #prompt{border-color:var(--paper2);border-image:}`，none被CSS压缩器丢失为空值，浏览器忽略该声明。立即报告root/ice，建议border-image-source:none长属性并验证构建产物。该图不能标作修复after。安全指标见[生产失败记录](build-failure/metrics.json)，产物见[失败CSS](build-failure/compiled-css.txt)。浏览器已关闭等待修正。

## 阶段三：efb9527修正后的最终生产build——全部通过

明确无资源拦截、无临时DOM CSS：使用脚本production-fixed参数，其值不匹配任何page.route分支，页面从7777原样加载。原私有context、同一角色、320×844英文触屏仿真。

1. 初始加载后稳定s002：完整长文案`F the Floo Network (the Great Hall)`全宽羊皮纸底色和纸色边，已view_image目检。
2. 实际触摸原生手掌`#tb-act`，出现5目的地及距离（s003）；触摸Cancel关闭（s004），不是直接调用游戏函数。
3. 正常按W 1100ms离开火炉：提示消失（s005）；按S 1100ms返回，提示恢复；另取稳定s007，目检再次完整底色和全文。
4. 初载及返回只读computed `borderImageSource=none`，原宽317.828125、高46.5625不变；边框7px rgb(231,212,168)，纹理三层、原transform/动画、willChange auto均保持。
5. 没有JS pageerror或console error，仅一次KHR_parallel_shader_compile软件渲染警告。
6. 浏览器已关闭，CPU释放给中文回归。

最终安全证据：
- [真实游戏 baseline](screenshots/english-baseline.png)；[打包 CSS 前后图](layout.md)是独立 DOM 对照，不与本图混同。
- 初载图 production-fixed/s002 未重复归档；对应只读指标保留。
- production after离开返回：[离开返回后的最终生产图](screenshots/english-final-return.png)。
- 只读生产指标及功能动作：[production-metrics.json](english/production-metrics.json)。
- 正确打包规则片段：[正确打包CSS片段](english/compiled-css.txt)。

与阶段一候选拦截图和阶段二失败图明确分开，只有本节才是最终产品after。所有选图无密钥或配对码；私有context不归档。

# 第 11 轮：390px 中文教程 after 真实回归

2026-10-03，本地 ae8f3df build（与远程实现 `8798750` 代码树相同），7777，390×844 模拟视口、Chromium 触屏仿真下的真实游戏操作，软件渲染，新角色 GuideAfter11。真实指游戏内因果操作，不是物理手机或触屏硬件实测。沿真实流程推进，不注入 state/clock、不生成配对码、不读取密钥。14 次成功交互（含导航等待），额外 2 次未完成的驱动操作见边界。浏览器已关闭，CPU 窗口归还 root。

## 结论

2/8、3/8、6/8、8/8 先前被省略的文案现在均完整显示；准星选敌、第一击、符文代码展开/收起/装备、自动导航、开书、Tempus、Later、Gotit 均真实成功。符文展开时卡片与教程分离，正文没有横向溢出。pageerror 记录为空。完成提示显示正常，但完成×的实际点击未证实：提示在 Playwright 等待元素稳定期间自动隐藏，不能把 hidden=true 当成点击成功。

## 安全图与前后对照

本归档选择 5 张 after 截图；3/8 目的地正文与展开符文卡共用 s0005 作为对照。未选入的编辑器场景保留文字观察，未声称其截图已归档。

| 场景 | before | after | 实际变化 |
|---|---|---|---|
| 2/8 攻击 | [s0002.png](screenshots/tutorial-before-s0002.png) | [s0002.png](screenshots/tutorial-after-zh-s0002.png) | 攻击动作完整，方向行完整显示「↑小精灵17米」（自然更新为18米） |
| 3/8 去礼堂 | [s0005.png](screenshots/tutorial-before-s0005.png) | [s0005.png](screenshots/tutorial-after-zh-s0005.png) | 完整目的地「↓大礼堂45米」，带我去按钮独立一行且可点击 |
| 符文展开 | 无对应before | [s0005.png](screenshots/tutorial-after-zh-s0005.png) | 代码完整显示，教程与符文卡之间留有约8.7px，不遮摇杆/快捷栏；收起与装备成功 |
| 打开咒语书 | 未选入归档 | 未选入归档 | 顶部教程完整，编辑器从其下方开始，关闭与Tempus按钮可用 |
| 6/8 AI Agent | [s0010.png](screenshots/tutorial-before-s0010.png) | [s0012.png](screenshots/tutorial-after-zh-s0012.png) | 「连上你的AI Agent」完整；两个按钮分行，不压缩正文；Later成功 |
| 8/8 旅行 | [s0011.png](screenshots/tutorial-before-s0011.png) | [s0013.png](screenshots/tutorial-after-zh-s0013.png) | 「站到绿火旁，点手掌选目的地」完整显示，末字换行但无裁切；Gotit成功 |
| 完成 | 无对应before | [s0014.png](screenshots/tutorial-after-zh-s0014.png) | 「引导完成，玩得开心！」完整显示 |

以上图均无配对码和密钥，可公开用于修复证据。

## 实际交互顺序

入学 → 摇杆向前1.8秒 → 准星选敌 → 1号昏昏倒地首击（目标24→9HP，真实符文掉落）→ 符文代码展开 → 收起 → 装昏昏倒地 → 带我去 → 等待10秒到礼堂 → 打开咒语书 → 关闭编辑器 → 教程施放Tempus → Later直接进入8/8 → Gotit显示完成提示。

## 只读 DOM 几何与错误

- 2/8：教程 x=8、width=374、height=70、bottom=546；正文 scrollWidth/clientWidth 均258。
- 展开符文时：教程 bottom=371；符文 top=379.734、height=166.266、bottom=546；间距8.734px。符文 scrollWidth/clientWidth 均372。
- 6/8：教程 height=118，正文宽度258且无横向溢出，完整「连上你的 AI Agent」与两个按钮。
- 8/8：教程 height=70，正文 scrollWidth/clientWidth 均186，完整目的地动作句。
- 摇杆 top=566，快捷栏 top=744；上述底部教程/符文bottom=546，不覆盖这些触摸区域。
- 所有快照 `errors=[]`，监听项为浏览器 pageerror，未额外抓取可能含私密内容的控制台日志。
- 原始安全 JSON：[step2-metrics.json](tutorial-zh/step2-metrics.json)、[rune-expanded-metrics.json](tutorial-zh/rune-expanded-metrics.json)、[step6-metrics.json](tutorial-zh/step6-metrics.json)、[step8-metrics.json](tutorial-zh/step8-metrics.json)、[final-metrics.json](tutorial-zh/final-metrics.json)。

## 未覆盖与工具边界

1. 第一次尝试展开符文使用了错误的 `summary` 选择器，等待30秒未发出触摸；改为页面实际 `[data-code]` 按钮后成功。这是驱动错误，不是产品问题。
2. Gotit后观察完成截图，再请求点击×。Playwright日志显示等待元素稳定，之后元素已不可见，没有证据证明触摸曾发出。最终metrics显示教程hidden=true，属于自动隐藏结果；不宣称×实测通过。该pending操作随browser关闭结束，未产生s0015截图。已即时通知root和英文回归Agent纠正口径，建议后者Gotit后立即原生触摸×验证。
3. 7/8成功连接Agent路径未覆盖；Later路径到8/8真实通过。
4. 软件渲染截图与思考耗时不等于真人帧率/输入时延，不据此声称性能收益。

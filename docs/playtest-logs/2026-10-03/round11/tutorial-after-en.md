# 第 11 轮：320px 英文教程 after 真实游戏回归（2026-10-03）

## 结论

2/8战斗、3/8安全区+符文卡、6/8可选配对、Later跳8/8旅行、Got it完成与完成提示×触摸关闭均通过。所有目标引导文案完整可读，无省略号截断；其按钮实际能触摸执行。浏览器已关闭。

## 方法

远程产品实现 `8798750`，本地实测整合代码树相同。这里“真实”指游戏中的因果操作；视口与触摸事件由 Chromium 仿真，并非物理手机或触屏硬件实测。

- Chromium真实页面：http://127.0.0.1:7777/?q=low&view=top；320×844 CSS px、deviceScaleFactor 1、hasTouch/isMobile，SwiftShader软件渲染。
- 新角色 NarrowRowan 从中文网页填名入学。通过真实触摸“卷轴抽屉→更多→菜单→English”切语言，页面reload保持该角色和1/8；没有手写localStorage、重置教程、改游戏state或直发WS。
- 后续仅真实触摸摇杆、目标按钮、热栏1、符文代码、装备、Take me there、Open、关闭书、Cast、Later、Got it和完成×。不生成配对码，不显示/读取密钥。
- 测试驱动记录了 19 张截图，本归档仅保留下面 5 张关键安全截图；边界数据为只读 DOM。即时 Got it / × 触摸结果已从动作日志提取进 [metrics.json](tutorial-en/metrics.json)，不复制完整驱动日志。
- 软件渲染截图约5–20秒，截屏与随后文本读数偶有数秒时差，不能用作真实硬件帧率。

## 真实操作与证据

1. 网页入学→实际菜单切English：s001–s005。Muggle/NarrowRowan保持同角色，教程仍1/8。
2. 左摇杆上推2600ms：进入2/8。`Tap a pixie (or ⊕), then 1`整句及独立`pixie N m`距离行可读（s006目检）。教程宽304、高70；tut-line宽188，overflow visible/white-space normal，字形溢出约2px来自SVG箭头但没有裁切。
3. 触摸目标按钮锁定24/24 Cornish Pixie→热栏1施法：目标9/24，获得Split新符文，进入3/8。
4. 3/8显示`To the Great Hall (safe)`、独立距离行和完整`Take me there`44px高按钮。折叠符文卡top399.22/教程bottom391，间隔8.22px；卡片bottom546，触控区top556，间隔10px。
5. 真实点Rune code展开：卡片top360.84/教程bottom352，间隔8.84px；教程及卡片均保持屏内。s009目检英文安全区信息、Take me there、源码同时完整显示。按钮文字存在非本轮遗留，见下。
6. 点Equip Stupefy：卡片隐藏，热栏1出现S符文标记。点Take me there：自动走至Great Hall，进入4/8。
7. 点Open开书，再点书关闭按钮，点Cast施放Tempus：进入6/8。
8. 6/8截图s016：`Connect your AI agent`、`Get a code`、`Later`均完整可见。动作区高44px；教程bottom546、触控区top556，间隔10px。未触摸Get a code。
9. 实际点Later直达8/8。s018目检旅行整句`By a green fire, tap the hand to travel`分三行完整显示；tut-line client与scroll均120×61，无裁切。Got it和×均可见；动作按钮44px。
10. Got it与完成×验证特意不先截图：/finish先触摸Got it，150ms后确认`#tutorial button[data-act=close]` visible，读取`✦\nAll set. Enjoy!`及×bounds，立即touchscreen按中心坐标触摸×，150ms后hidden=true。日志返回`{completedText:"✦\nAll set. Enjoy!",tappedClose:true,hidden:true}`。该路径没有等locator稳定，也没有等待自动消失冒充关闭。随后s019确认教程已关闭。
11. 关闭浏览器。

## 安全截图清单

- [s006.png](screenshots/tutorial-after-en-s006.png)：2/8战斗完整文案。
- [s009.png](screenshots/tutorial-after-en-s009.png)：3/8安全区+展开符文卡，全部控制区不重叠。
- [s016.png](screenshots/tutorial-after-en-s016.png)：6/8可选连接、两个完整按钮。
- [s018.png](screenshots/tutorial-after-en-s018.png)：8/8三行旅行文字及Got it。
- [s019.png](screenshots/tutorial-after-en-s019.png)：真实关闭完成提示后的画面。

上述截图不含密钥或配对码，可复制进仓库作为证据。菜单截图s004也未点“显示密钥”，但本轮证据优先只用清单中的游戏截图。

## 错误与范围边界

- 无JS pageerror、console error。仅页面初载与切语言reload各一次`THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported.`警告。
- 非阻断既有问题：320px英文符文装备按钮仍显示`Equip St…`、`Equip In…`、`Equip Ag…`，完整title/aria存在但触屏用户不一定能发现；实际第一按钮装备有效。已向主agent报告，按本轮范围不临时扩展修复，不把aria存在当成用户可见。
- 本轮专门验证引导的完整可读性，不声称其他世界提示、目标名和NPC文本全量本地化/不截断。

- 下一轮观察：s016/s018中央Floo提示右半英文落在较深背景上、对比偏低，是既有组件的可读性问题，本轮未确认属于新回归。

只读几何与即时完成×操作记录单独归档：[metrics.json](tutorial-en/metrics.json)。

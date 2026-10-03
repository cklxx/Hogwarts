# 手机长菜单真实回归


390×844，新角色 PhoneMenuProbe，普通「更多→更多页→菜单」进入；未生成配对码、未显示密钥。旧版与新版在同一个 browser context/同一角色，通过页面 reload 获取新 build。所有滚动均为 CDP 真实触屏上滑（不是写 scrollTop），未修改游戏状态。

旧版：两次上滑后菜单 scrollTop=810，右上关闭按钮 top=-781、bottom=-735，完全离开视口；再两次滑到底，scrollTop=917，关闭按钮 top=-888。固定在屏幕最顶端的是新手引导的×，并非菜单×。安全证据 `/tmp/hogwarts-phone-menu/before-middle.png`、`before-bottom.png`。

新版：同样四次实际上滑，菜单标题与×保持可见；中途和到底时，菜单×均 top=93、bottom=139。顶部新手引导约 y=10–60，与菜单×不重叠。最终实际触摸菜单×成功，菜单 hidden=true，截图确认回到游戏。主菜单 #menu 自身 scrollTop=0 是新结构将滚动移至 .op-body 的正常结果；本脚本未读取 .op-body 精确 scrollTop，不将 0 错报成未滚动。截图中正文已位于密钥说明、语言与底部返回区，证明真实滑动已完成。

选用安全 after 证据 `menu-after-bottom.png` 与 `after-closed.png`；`after-middle.png` 恰逢自然学期结束弹出学院杯卡，虽然菜单×仍可见，但不适合主对照图。所有截图无配对码或真实密钥（界面中的 ${HOGWARTS_TOKEN} 是公开命令模板占位符，登记号亦为公开角色号）。

实际操作：入学 1 次；旧版开抽屉/更多/菜单 3 次 + 上滑 4 次；reload 1 次；新版开抽屉/更多/菜单 3 次 + 上滑 4 次 + 点击关闭 1 次，共 16 次触摸操作及 1 次页面 reload。截图过程中并行 vitest 占用 CPU，延迟不作为产品性能结论。after 请求完成后已 browser.close，释放渲染资源。

补充：旧版滑到底仍有「回到城堡」按钮；本次修复的是滚动中随时可见的顶部关闭入口，不宣称旧菜单完全无法退出。

公开对照：[修改前](menu-before-bottom.png) → [修改后](menu-after-bottom.png)，[点击关闭后](menu-after-closed.png)。

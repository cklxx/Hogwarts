# 后续试玩修复证据

基于已合并的 PR #12，继续处理第 10 轮真实反馈。

- [手机菜单同角色前后回归](phone-menu.md)：16次真实触摸、一次reload，标题和关闭按钮保持可见，实际点击关闭。
- [导航真实MCP回归](navigation.md)：idle / arrived / interrupted 三种合法工具路径。
- `menu-before.json` / `menu-after.json` 为真实页面只读边界；after 的 #menu 自身不滚动，正文 .op-body 承担滚动，0 不代表没有实际滑动。正文到底由截图确认。
- `menu-layout.json` 为16组、48滚动位置的纯DOM夹具，不代替实际游戏。
- `tests.log` / `build.log` 为最终整合验证。内核和formal源码与已通过验证的main相同，没有修改规则或弱化证明。

[修改前](menu-before-bottom.png) · [修改后](menu-after-bottom.png) · [关闭后](menu-after-closed.png)

图片中的 `${HOGWARTS_TOKEN}` 是公开命令模板占位符，角色登记号也是公开信息；没有生成配对码或显示真实密钥。旧菜单底部原有「回到城堡」，本次提升的是滚动途中随时可见的关闭入口。

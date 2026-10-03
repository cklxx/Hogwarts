# 第 13 轮：390px 中文 Floo 提示最终生产回归

2026-10-03，最终远程 `6b20ea2` / 本地 `efb9527` production build，7777，390×844 Chromium 触屏仿真与软件渲染（非物理手机/触屏硬件实测）。新角色 **FlooChinese13** 通过普通入学页注册；未复用旧角色、未读服务器凭证。未注入状态、未改CSS、未拦截资源。完成后已关闭browser，root收到BROWSER_CLOSED。

## 核心结论

全部目标通过：正常走到礼堂后「F 使用飞路网 ·『礼堂』」全文与纸底完整；通过实际摇杆离开让提示隐藏，再走回使提示重现；实际原生触摸手掌打开含5个目的地的飞路网菜单，点击「取消」成功回到游戏并保留完整提示。整轮pageerror为空。

初次提示与重现/取消后的computed borderImageSource均为 **none**，确认为最终生产CSS生效，未在浏览器改样式。提示矩形width224.281、height46.563、x82.859、right307.141，文本scrollWidth=clientWidth=210。离开后prompt.hidden=true且矩形尺寸0；手掌交互前与取消后hidden=false、全文仍在。

## 实际操作与限制

共18次有因果交互：普通入学、前移、准星选敌、首击得符文、装备、带我去礼堂、等待到达；向后离开、前移返回、手掌试交互、继续前移、手掌试交互、向后调整、点场景靠近壁炉、手掌试交互、100ms摇杆微调、立即坐标触摸手掌、取消。

软件渲染下较长摇杆动作容易越过壁炉交互范围，前三次手掌尝试时提示已消失，没有打开菜单；最终100ms正常摇杆微调后prompt可见，立即触摸手掌成功。此处如实记录操作成本，不把站位越界误报成点击无效产品bug。没有使用键盘输入或内部位置修改，也没有重复扩展其他系统。

菜单实际可见五个目的地：庭院38m、魁地奇球场92m、黑湖岸边110m、海格小屋116m、霍格莫德208m。取消后截图确认回到游戏。未实际旅行到其他目的地，本轮验证范围是提示渲染与开关菜单。

## 安全证据

归档精选仅1图：[重现后的完整提示](screenshots/chinese-final-return.png)（实际离开返回后的完整提示纸底）。

安全结构化数据：[summary.json](chinese/summary.json)；含初显/离开/交互前/取消后的prompt只读metrics、页面错误与观察汇总。原始安全metrics为[initial.json](chinese/initial.json)、[away.json](chinese/away.json)、[pre-interact.json](chinese/pre-interact.json)、[final.json](chinese/final.json)。

菜单与取消观察由本地s0017.png、s0018.png和驱动操作响应核对，**没有采集picker DOM，因此summary的menu字段属于真实截图观察，不冒称DOM测量**；按归档要求不额外复制它们。所有图片/数据均无配对码或私钥。

本轮软件渲染/截图/Agent耗时不用于判断真实手机FPS。结论仅为390px中文生产路径通过，英文与其他屏宽由独立回归负责。

归档说明：截图与只读 JSON 来自连续操作而非同一冻结帧；未选入的 returned/reappeared/visible-again 中途文件实际 hidden=true，属于未回到范围的尝试，未用来证明重显。归档 JSON 仅压缩空白。

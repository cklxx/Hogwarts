# 第12轮：320px英文符文完整标签真实回归

2026-10-03，before PR14 基线 `a2b548c` → after 远程实现 `d3afe89`（本地423839e、开发09785bc代码树相同）。结论：Stupefy/Incendio/Aguamenti全文可见，符文展开/收起正常，实际选择第三个Aguamenti服务器装备成功。浏览器已关闭。

## 方法与连续性

- 320×844 CSS px，DPR1，Chromium移动触屏仿真，?q=low&view=top，SwiftShader软件渲染；并非物理手机，不记录硬件帧率。
- before新角色NarrowRowanTwelve从网页入学，通过卷轴→更多→菜单实际点击English切语言。真实触摸摇杆、选目标、热栏1，造成伤害拿Split，停在3/8、卡片未装备。
- before结束浏览器context由Playwright私有保存并设0600，释放CPU。新build后通过同一context恢复同角色、同3/8与未装备Split；未读出凭证，未改localStorage/tutorial/game state，未直发WS。
- 归档仅选择四张关键截图及[只读指标](english/metrics.json)。私有 context 文件不属于证据，没有读取或归档；指标 JSON 仅压缩空白，保留原始字段。

## Before

`rc-short`可用宽约79px，三个英文的scrollWidth依次99/105/120px，nowrap+overflow hidden，截图s009显示Equip St…/Equip In…/Equip Ag…，足以复现原问题。

## After核心回归

1. 恢复角色后折叠卡片s101：三个按钮完整两行显示`Equip Stupefy`、`Equip Incendio`、`Equip Aguamenti`，目检通过。
2. 三个文字span均clientWidth=scrollWidth=79，clientHeight=scrollHeight=36，white-space normal、overflow visible；三个按钮均宽91.33、高44.375px，满足44px触控目标。
3. 真实点Rune code展开s102：源码全可读，卡片高185.53px、top360.47；教程bottom352，间距8.47px。卡片bottom546，触控区top556，间距10px；摇杆top566，快捷栏top744，均不重叠。
4. 再点Rune code收起s103：回到147.16px高，三个完整标签保持。
5. 真实点第三个Aguamenti装备：卡片消失，服务器回传HUD只在快捷栏3显示`data-rune="S"`；1、2仍无符文。未选入的s104及已归档s107可见3号水滴格上的S，确认选中第三项而非误装第一项。
6. 卡片计算样式仍overflow auto，844px高度下内容全部放得下（展开clientHeight=scrollHeight=184），无需内部滚动。本轮未制造溢出或宣称验证了实际滚动手势。
7. 随后真实点Take me there进入礼堂，教程正常进入4/8；无JS pageerror，仅1条SwiftShader KHR_parallel_shader_compile警告。

## 精选安全图

- [s009.png](screenshots/runes-en-s009.png)：before省略标签。
- [s101.png](screenshots/runes-en-s101.png)：after折叠全文标签。
- [s102.png](screenshots/runes-en-s102.png)：after展开源码、全文标签与教程间距。
- s103 的真实收起观察保留在操作记录中，本归档未重复选入该图。
- [s107.png](screenshots/runes-en-s107.png)：实际Aguamenti装备后的3号S，礼堂Floo观察。

上述均无密钥/配对码。完整日志有菜单公开登记号但没有生成配对码或显示密钥；归档只选上述图片和metrics。

## Floo后续调查的同场景证据

到礼堂后未选入的s106与已归档s107连续复现提示右半段缺少浅色底：约x166开始英文落在深色地板上。未改样式或冻结游戏，只读取当前页面。

- `#prompt` rect：x1.086、width317.828，y328.024、height46.563；文字Range右端295.914，几何完整在屏内。
- computed：opacity1、filter none、z-index3、mix-blend-mode normal，transform matrix(1,0,0,1,-158.914,-46.5625)，字色rgb(42,27,15)。
- background：2层SVG噪声纹理 + 原羊皮纸radial-gradient，background-color rgba(0,0,0,0)。
- 左右点(11.086,351.305)、(308.914,351.305)的elementsFromPoint均`#prompt > canvas#view > body.phone.touch.topview.cup > html`，没有别的DOM元素覆盖。
- 图与读数是相邻调用、同一站位场景，不是严格同一渲染帧；SwiftShader截屏耗时数秒。此限制保留，不能将计算样式完好等同于截图无问题。

Floo现象是既有待查问题，本轮完整符文标签修复通过，未扩大到Floo修复。

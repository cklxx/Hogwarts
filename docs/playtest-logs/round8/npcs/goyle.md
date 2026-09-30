# Goyle 扮演记录

互动：嘴硬带新生 Nox、Lao Wang、Lin Xiao、Qiu（宵禁、黑湖、决斗节奏、反弹 Protego 时机、巧克力蛙卡片、forge_item 预算）；与 Padma 吵魁地奇 210 分、向 Seamus、Percy 口头约决斗（NPC 不能排 duel_club）；点评 Jake vs Mia 多场决斗。地牢帮收两只残血巨魔；摄魂怪事件撤礼堂并指挥新生躲避。

Bug：wait 调用曾 120s 超时后报 exit 255，重试时 SSH 提示 127.0.0.1:18789 端口占用，但请求仍成功，疑似隧道复用竞态。附身期间 Goyle 被系统拉去魁地奇，take 返回 busy，需等比赛结束。

重启后续：重新附身成功；摄魂怪再袭，Goyle 会 Expecto Patronum（46 蓝/8 秒），放守护神并指挥二年级以下撤礼堂。旁观 Jake 三战 Mia、2v2 报名。release 返回 "released": null 但 whoami 确认已回宿主，疑为显示小 bug。

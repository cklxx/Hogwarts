# 宣传片素材来源 / Promo credits

| 素材 | 来源 | 许可 |
|---|---|---|
| 画面 | 本仓库的游戏本身：真实内核 + 真实客户端逐帧离线渲染（`scripts/promo/render.ts`） | 同本仓库 |
| 配乐 | **原创**。由 `scripts/promo/music.ts` 用纯算术合成（正弦 + 非谐波泛音的八音盒、Karplus–Strong 拨弦、失谐锯齿波弦乐铺底、定音鼓、施罗德混响），没有采样、音色库或任何他人的旋律；G 大调 3/4 拍圆舞曲，夜景段落转 E 小调，每个镜头切点都落在拍子上（`story.ts` 的 `BPM`） | 同本仓库 |
| 字体 | Google Fonts：Ma Shan Zheng、Noto Serif SC、Cinzel | SIL Open Font License 1.1 |
| 贴图 / 天空 | 游戏自带的 CC0 PBR 贴图与 HDRI（见仓库根目录的素材说明） | CC0 |

配乐不使用、也不模仿任何《哈利·波特》电影配乐。响度在编码时用 ffmpeg `loudnorm` 标准化到 −16 LUFS（真峰值 −1.5 dBTP），AAC 160 kbps。

# 低画质冷启动黑湖：只读源代码与 CPU 级 Three Water 复核

范围：Visual 正在真实一小时试玩；本专项未开浏览器/WebGL，未改 repo 或服务器，未计入玩家小时。实游来源为 root 提供的 Visual 同湖岸两次冷启动比较，11:45:36 白天 (-82.7,39.7) 的低画质截图 53 与三个真实新帧没有 512 镜面 pass。

## 代码证据

client/scene.ts setQuality('low') 把 Water.onBeforeRender 整体替换为空函数。Three 0.186.1 的 Water.js 在该回调中除了 render(scene, mirrorCamera)，还计算 textureMatrix 与 eye.setFromMatrixPosition(camera.matrixWorld)。构造时 eye 默认 (0,0,0)，textureMatrix 默认单位阵，mirrorSampler 绑定尚未渲染的 WebGLRenderTarget.texture。

Cold low：没有任何镜面渲染，eye/投影也未初始化；镜面 sampler 没有有效场景图像。Water fragment 用 eye-worldPosition 计算 Fresnel 权重。以平水面 (-118,0.08,40) 为例，默认 eye 原点使视线指向水平略向下，theta=max(dot(view,normal),0)=0，reflectance=1，waterColor 的散射项被压到 0，主要取镜面 sample。未填充 RT 的黑/暗色叠加灯光、雾、后处理，可以解释实际黑/棕色。细节噪声法线会改变局部权重，此分析不是读取过 GPU 像素的证明。

High→low：上一次高画质镜面和 eye 被冻结，效果与冷 low 不一致。主程序 lighterLake 在高画质还隔帧更新镜面；低画质目前它包装的是空回调，仍没有初始化作用。

## 最小候选，无额外镜面 pass

`lake-quality-candidate.patch` 含 scene.ts 的少量接线和新的 client/lake-quality.ts：

1. 从已有 waterColor（Three Color 已在线性 RGB）生成一份 1×1 RGBA UnsignedByte DataTexture，存线性通道值，明确 NoColorSpace，禁用 mipmaps，needsUpdate=true。不是把十六进制 sRGB 字节直接当线性光上传。
2. Low 绑定该已初始化的纯色镜面 sampler；textureMatrix.identity()，保证顶点 mirrorCoord.w=1，避免从旧高画质投影遗留 w/UV。纯色 sampler 不需要相机反射投影。
3. Low 的 onBeforeRender 只从 camera.matrixWorld 更新 eye，不调用 renderer.render 或任何 renderer 状态/RT 方法。这同时覆盖跟随、2.5D、带父变换的相机。
4. 标记低 hook 的 lighter=true，主程序 lighterLake 不再隔帧节流这个便宜的 camera uniform 更新。
5. High 恢复 Water 原 RT texture 与既有 lakeReflect；原 Water hook 会重新计算 textureMatrix。Low→high→low 复用同一个 1×1 texture，保证每次恢复原 RT。
6. 将新纹理释放绑定至 Water material 的 dispose；移除监听后只释放一次。当前 WorldScene 没有整体 dispose API，该补丁没有凭空引入未调用的清理方法。页面退出的 WebGL context 回收仍沿用现有生命周期；显式 material.dispose 的新增资源清理已覆盖。

这保留既有波纹法线、时间、日照/雾和水面 shader，不增加灯光、几何、shader 分支或场景重渲染。新增的是一份 4 字节纹理源数据及其 WebGL 纹理对象；实际 GPU 最小分配不是 4 字节，未声称精确显存。High 本身仍保留 512 镜面 pass，Low 仍没有它。

纯色反射是低画质视觉回退，无法恢复高画质天空/景物反射。尚未验证实机低画质是否足够亮、夜间是否自然、真实纹理/帧成本；不得将 CPU uniform 回归当作生产画面验收。

## 回归与产物

`lake-quality.test.ts` 使用真实 Three Water，CPU 级执行回调，Fake renderer 的任何非 render 访问直接报错，render 计数也必须为零：

- 冷低画质：camera 有父节点世界平移，eye 与 matrixWorld 一致；1×1 数据按 Color 的线性值上传，NoColorSpace / 无 mipmaps / version=1，矩阵单位阵，镜面与 renderer 调用均为零。
- low→high→low：同一 fallback 复用，high 恢复同一个原始 RT，low 重新置单位矩阵并更新移动后的相机 eye；低画质不触发镜面回调。
- Material 连续 dispose 两次：fallback 只释放一次。

模拟当前 setQuality 的空 hook 为 baseline：3 条失败；候选 3 条通过。原始输出 `lake-tests-before.txt` / `lake-tests-candidate.txt`。补丁 `git apply --check` 成功。`lake-quality-candidate.ts` 是可单独运行的 scratch 源码，实际 patch 中使用正常 three imports。候选 project source-overlay typecheck 结果见 `lake-typecheck.txt`；没有实际改仓库。

执行：

```
CANDIDATE=0 node --import /workspace/Hogwarts/node_modules/tsx/dist/loader.mjs --test /workspace/scratch/playtest-hour-2026-10-04/repro/lake-quality.test.ts
CANDIDATE=1 node --import /workspace/Hogwarts/node_modules/tsx/dist/loader.mjs --test /workspace/scratch/playtest-hour-2026-10-04/repro/lake-quality.test.ts
```

生产验证建议：在隔离 checkout 应用候选、全量 typecheck/tests/build；以同角色同湖岸同时间/相机比较 cold low、high、high→low、low→high→low，storybook/real、日/夜；每个等待至少三个实际新帧，确认 low 无 512 render target pass，camera.eye 随相机移动，shader 无错误；记录 frame dt、draw calls、textures 的前后变化。不要先跑 high 初始化 RT 再把 low 当作 cold low。

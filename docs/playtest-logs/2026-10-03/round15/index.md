# 第 15 轮：为真机验证修正帧间隔遥测

2026-10-03，基线为已合入 PR #17 的 `ff556bc`，实现 `6f77a26`。本轮没有硬件 GPU 或物理手机，完成的是采集链路验证。

原客户端每 15 秒丢弃少于 30 帧的窗口，低于约 2fps 的慢设备因此缺少报告。页面切后台再回来时，暂停的时间也可能混入帧间隔。原报告用 p50 的倒数写「fps」，且通用 WebKit WebGL 字样不能识别软件渲染。

修复：至少 2 个前台渲染间隔即可报告，带样本数与合计时长；visibilitychange 清空样本和时间基准，返回后的首帧不计间隔。保留前台长帧，不使用动画的 100ms 截断值。优先读取浏览器允许的 unmasked renderer，屏蔽时保留通用名称；报告标明软件渲染或硬件信息不可用，并直接显示 p50/p95 帧间隔。旧报告显示「样本数/时长未记录」。

## 验证

- 81 文件、**820 项测试通过**；类型检查与生产构建通过。
- 7 个新增测试覆盖 1fps/15 秒窗口、前台停顿、后台期间无 rAF、后台帧、样本耗尽、软件 renderer 和旧版 masked renderer 报告。
- 现有真实 World 指标测试扩展验证样本数/时长的接收、上限、非有限数与保存恢复。
- 生产浏览器 UI 入学，旁听真实 WebSocket 出站帧；没有注入 metrics 或修改世界。900×600、DPR1、Chromium ANGLE/SwiftShader，pageerror 为空。关闭浏览器并正常停服保存后，运行正式 report 脚本。

| 字段 | 浏览器真实窗口 | 保存后报告 |
|---|---:|---:|
| 帧间隔数 | 7 | 7 |
| 合计时长 | 12.8553s | 12.86s |
| p50 | 755ms | 755ms |
| p95 | 5530.3ms | 5000ms（沿用服务端上限） |
| 渲染器 | SwiftShader | 明确标为软件渲染 |

这 7 个间隔不足原来的 30 帧门槛，原逻辑会丢弃该窗口。此次确认数据可见，不宣称速度改善。这里的帧间隔包括 CPU、浏览器、GPU 与显示节奏，不是 GPU 执行时间。保存指标沿用 5000ms 截断和 80 字符 renderer 上限，表中已明确差异。

证据：[浏览器原始样本](browser-sample.json)、[保存后的纯指标](stored-sample.json)、[正式报告](report.txt)、[可重跑的生产浏览器检查](runtime.mjs)。没有归档世界存档或登录密钥。

```bash
npm ci && npm run build
# 在独立终端启动生产服务器，HOGWARTS_DATA 设为仓库外的私有路径。
npm install --prefix /tmp/hogwarts-browser playwright-core
PLAYWRIGHT_CORE=/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs \
  node docs/playtest-logs/2026-10-03/round15/runtime.mjs
# 正常停服保存，再读取存档；输出报告不含身份密钥。
npx tsx scripts/playtest/report.ts /path/to/private/world.json
```

物理手机触控、硬件 GPU 帧间隔和真人试玩仍待完成。采集阶段及设备记录见 [真机步骤](../../../PLAYTEST_METRICS.md)。无玩法规则、奖励、权限、共享常量或形式化源码变更。

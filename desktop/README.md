# 霍格沃茨桌面客户端（微客户端）

约 10 MB 的 Tauri 2 壳。游戏本身仍是服务器上的网页（HTTP，浏览器照样能玩）；壳多做四件浏览器做不到的事：

- **自动找服务器**：打开就列出局域网里的霍格沃茨服务器（服务器在同端口号的 UDP 上回应发现请求），不用输 IP；也能手动输入，记住上次去的服务器，下次直接进。
- **永远和服务器同版本**：壳直接加载服务器的页面；服务器升级后游戏提示「游戏已更新」，空闲 1 分钟自动刷新。壳本身很少需要更新。
- **密钥在系统钥匙串**：每个服务器一条（macOS 钥匙串 / Windows 凭据管理器 / Linux Secret Service）。重装、清缓存都不丢号；密钥在别处被更换后，钥匙串里的旧钥也会一起删掉。
- **一键连接我的 Agent**：启动器里点「写入 Claude Desktop」或「添加到 Claude Code」，客户端自己就是 MCP 桥（`hogwarts-desktop --mcp-stdio`，连上次进入的服务器，或 `--server http://<ip>:7777`）；密钥从钥匙串读，不写进任何配置；Agent 拿到的新钥匙也存进钥匙串。
- **F11 全屏，Ctrl+Shift+S 回到服务器列表**（macOS：中文菜单栏，「显示 → 进入全屏幕」⌃⌘F、「游戏 → 换服务器…」⇧⌘S；F11 在 Mac 上是系统的「显示桌面」）；游戏里指向其他网站的链接用系统浏览器打开，游戏窗口只显示它的服务器。

### macOS

- 菜单栏全中文：霍格沃茨（关于 / 隐藏 / 退出 ⌘Q）、编辑（⌘Z ⌘X ⌘C ⌘V ⌘A 在聊天框和咒语编辑器里都能用）、游戏、显示、窗口。
- 声明为游戏（`LSApplicationCategoryType` 角色扮演 + `LSSupportsGameMode`）：macOS 14 起全屏时自动打开「游戏模式」。
- 「本地网络」权限框里有说明文字（`NSLocalNetworkUsageDescription`，macOS 15 起连局域网要先问）；开发语言中文（`src-tauri/Info.plist`，打包时并进 app）。
- 游戏页面里（浏览器里的 Safari 也一样）：拼音 / 注音输入法按回车上屏不会把半截名字或聊天发出去；触控板双指上下滑缩放、左右滑转视角、捏合缩放，Ctrl+按住拖动转视角（相当于右键拖）；⌘ 组合键不会触发游戏按键，按住 ⌘ 时松开的键不会「卡住」。
- 安装包没有签名：更新后第一次进服务器，系统可能会问能否使用钥匙串里的「hogwarts-desktop」，点「始终允许」（启动器会提示）。签名后就不会再问。
- 测试（不需要亮屏，锁屏、合盖也能跑）：`npx tsx scripts/mac-input.ts`（无头 WebKit，上面这些输入）。

安全：游戏页面只能调用三个命令（保存密钥、全屏、换服务器），而且只在所选服务器的地址下有效；保存密钥时 Rust 端会再核对一次调用方地址。

## 下载

GitHub Actions 的「Desktop client」工作流为 Windows（`.exe` 安装包）、macOS（通用 `.dmg`）、Linux（`.AppImage` / `.deb`）构建，产物在该次运行的 Artifacts 里。暂未签名：macOS 第一次打开要右键 →「打开」；Windows 点「更多信息 → 仍要运行」。

## 开发

```bash
cd desktop && npm ci
npx tauri dev          # 调试运行
npx tauri build        # 打包当前平台
cargo test --manifest-path src-tauri/Cargo.toml
```

Linux 需要 `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`。端到端测试（Xvfb + 钥匙串 + 真服务器）：`dbus-run-session -- bash desktop/test-gui.sh /tmp/hw-gui`。

## 结构

- `ui/`：启动器页面（服务器列表），纯 HTML/JS，无打包步骤。
- `src-tauri/src/lib.rs`：发现（UDP 广播）、`/api/version` 探测与协议检查、打开游戏窗口、钥匙串桥（注入游戏页面的初始化脚本）。
- `src-tauri/build.rs`：给每个命令生成权限；`capabilities/launcher.json` 只给启动器页面，游戏页面的权限在连接时按服务器地址动态授予。

//! Hogwarts desktop micro-client.
//!
//! Two windows. The **launcher** (a local page, `ui/`) lists the servers on the LAN (the server's UDP discovery,
//! src/server/discovery.ts), the ones used before, and takes an address by hand. The **game** window loads the
//! chosen server's own page, so the game is always the server's version (its "游戏已更新" notice reloads it).
//!
//! What the shell adds to the browser game:
//! - the Owl Post key lives in the system keychain (per server) and is handed back to the page when it opens, so a
//!   reinstall or a wiped web profile still lands you in the world;
//! - F11 full screen, Ctrl+Shift+S back to the server list (macOS: a Chinese menu bar, ⌃⌘F and ⇧⌘S, see `mac_menu`);
//! - links to other sites open in the system browser; the game window only ever shows its server.
//!
//! Safety: the game page may call exactly three commands (key_store, toggle_fullscreen, switch_server), granted at
//! runtime to that server's origin only, and key_store checks the caller's origin again.

mod bridge;

use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Must match src/server/discovery.ts.
const PROBE: &[u8] = b"HOGWARTS?";
const PROTOCOL: u32 = 1;
const DEFAULT_PORT: u16 = 7777;
/// The game client's localStorage key for the Owl Post key (client/main.ts `LS`).
const KEY_LS: &str = "hogwarts.token";
const KEYCHAIN_SERVICE: &str = "hogwarts-desktop";
/// tauri.conf.json `identifier`: the app's config directory name (the --mcp-stdio mode reads it without Tauri).
const IDENTIFIER: &str = "io.github.cklxx.hogwarts";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Info {
    pub name: String,
    pub version: String,
    pub build: String,
    pub protocol: u32,
    pub players: u32,
    #[serde(default)]
    pub port: u16,
}

#[derive(Serialize, Clone, Debug)]
pub struct Found {
    #[serde(flatten)]
    pub info: Info,
    pub address: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Config {
    pub last: Option<String>,
    pub known: Vec<String>,
}

#[derive(Default)]
struct Shell {
    /// The origin the game window is showing (the only one key_store accepts).
    origin: Mutex<Option<String>>,
    caps: AtomicUsize,
}

/// "10.0.0.5", "10.0.0.5:8000", "http://host:7777/" → "http://10.0.0.5:7777" (the server's origin).
pub fn normalize(input: &str) -> Result<String, String> {
    let s = input.trim().trim_end_matches('/');
    if s.is_empty() {
        return Err("请输入服务器地址".into());
    }
    let with_scheme = if s.contains("://") { s.to_string() } else { format!("http://{s}") };
    let mut u = url::Url::parse(&with_scheme).map_err(|_| format!("看不懂这个地址：{input}"))?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return Err("只支持 http:// 或 https:// 地址".into());
    }
    if u.host_str().is_none() {
        return Err(format!("看不懂这个地址：{input}"));
    }
    if !s.contains("://") && u.port().is_none() {
        let _ = u.set_port(Some(DEFAULT_PORT));
    }
    Ok(u.origin().ascii_serialization())
}

fn broadcast_targets() -> Vec<Ipv4Addr> {
    let mut out = vec![Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST];
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for i in ifaces {
            if let if_addrs::IfAddr::V4(v4) = i.addr {
                if let Some(b) = v4.broadcast {
                    if !out.contains(&b) {
                        out.push(b);
                    }
                }
            }
        }
    }
    out
}

/// Probe the local networks and collect the servers that answer within `wait`.
pub fn find(port: u16, wait: Duration) -> Vec<Found> {
    let Ok(sock) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else { return vec![] };
    let _ = sock.set_broadcast(true);
    let _ = sock.set_read_timeout(Some(Duration::from_millis(100)));
    for t in broadcast_targets() {
        let _ = sock.send_to(PROBE, SocketAddr::from((t, port)));
    }
    let mut found: Vec<Found> = vec![];
    let end = Instant::now() + wait;
    let mut buf = [0u8; 2048];
    while Instant::now() < end {
        let Ok((n, from)) = sock.recv_from(&mut buf) else { continue };
        let Ok(info) = serde_json::from_slice::<Info>(&buf[..n]) else { continue };
        let address = from.ip().to_string();
        // one entry per server: it may answer on loopback and on its LAN address; keep the LAN one
        let same = found.iter().position(|f| f.info.name == info.name && f.info.port == info.port && f.info.build == info.build);
        if let Some(i) = same {
            if found[i].address != "127.0.0.1" {
                continue;
            }
            found.remove(i);
        }
        let url = format!("http://{}:{}", address, info.port);
        found.push(Found { info, address, url });
    }
    found
}

fn version_of(origin: &str) -> Result<Info, String> {
    let r = ureq::get(&format!("{origin}/api/version"))
        .timeout(Duration::from_millis(2000))
        .call()
        .map_err(|e| format!("连不上 {origin}（{e}）"))?;
    r.into_json::<Info>().map_err(|_| format!("{origin} 不是霍格沃茨服务器（或版本太旧，没有 /api/version）"))
}

fn config_path(_app: &AppHandle) -> Option<std::path::PathBuf> {
    config_dir().map(|d| d.join("servers.json"))
}
fn load_config(app: &AppHandle) -> Config {
    config_path(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn save_config(app: &AppHandle, c: &Config) {
    if let Some(p) = config_path(app) {
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(p, serde_json::to_vec_pretty(c).unwrap_or_default());
    }
}

pub(crate) fn config_dir() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join(IDENTIFIER))
}

/**
 * Is there a keychain to talk to? Always on macOS and Windows. On Linux the Secret Service lives on the D-Bus
 * session bus: an MCP client may start `--mcp-stdio` with a stripped environment (no DBUS_SESSION_BUS_ADDRESS), and
 * then the keyring library would try to autolaunch a bus and hang, so fall back to the standard per-user bus socket
 * or report no keychain.
 */
pub(crate) fn keychain_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        static OK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        return *OK.get_or_init(|| {
            if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some() {
                return true;
            }
            let uid = std::fs::read_to_string("/proc/self/status")
                .ok()
                .and_then(|s| s.lines().find(|l| l.starts_with("Uid:")).and_then(|l| l.split_whitespace().nth(1).map(str::to_string)));
            match uid.map(|u| format!("/run/user/{u}/bus")) {
                Some(p) if std::path::Path::new(&p).exists() => {
                    std::env::set_var("DBUS_SESSION_BUS_ADDRESS", format!("unix:path={p}"));
                    true
                }
                _ => false,
            }
        });
    }
    #[allow(unreachable_code)]
    true
}

pub(crate) fn keychain(origin: &str) -> Option<keyring::Entry> {
    if !keychain_available() {
        return None;
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, origin).ok()
}

/// Runs in the game page before its own scripts: hands the saved key back (only on that server's origin), keeps
/// the keychain in step with the page's key, and adds the shell's two shortcuts.
fn bridge_script(origin: &str, key: Option<&str>) -> String {
    let o = serde_json::to_string(origin).unwrap();
    let k = serde_json::to_string(&key).unwrap();
    let ls = serde_json::to_string(KEY_LS).unwrap();
    let cc = serde_json::to_string(&format!("claude mcp add -s user hogwarts -- \"{}\" --mcp-stdio", exe_path())).unwrap();
    let keys = serde_json::to_string(&KEYS).unwrap();
    format!(
        r#"(function () {{
  var O = {o}, K = {k}, LS = {ls};
  if (location.origin !== O) return;
  // the game's Owl Post shows the desktop client's own agent command instead of the Node bridge (client/main.ts)
  window.__HOGWARTS_SHELL__ = {{ claudeCode: {cc}, keys: {keys} }};
  var call = function (cmd, args) {{ var t = window.__TAURI_INTERNALS__; if (t) return t.invoke(cmd, args || {{}}).catch(function () {{}}); }};
  try {{ if (K && !localStorage.getItem(LS)) localStorage.setItem(LS, K); }} catch (e) {{}}
  var last = K;
  var sync = function () {{ try {{ var k = localStorage.getItem(LS); if (k !== last) {{ last = k; call('key_store', {{ key: k }}); }} }} catch (e) {{}} }};
  setInterval(sync, 2000);
  addEventListener('keydown', function (e) {{
    if (e.key === 'F11') {{ e.preventDefault(); call('toggle_fullscreen'); }}
    else if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {{ e.preventDefault(); call('switch_server'); }}
  }}, true);
}})();"#
    )
}

#[tauri::command]
async fn discover(port: Option<u16>) -> Vec<Found> {
    let port = port.unwrap_or(DEFAULT_PORT);
    tauri::async_runtime::spawn_blocking(move || find(port, Duration::from_millis(1200))).await.unwrap_or_default()
}

#[tauri::command]
async fn probe(url: String) -> Result<Info, String> {
    let origin = normalize(&url)?;
    tauri::async_runtime::spawn_blocking(move || version_of(&origin)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn saved(app: AppHandle) -> Config {
    load_config(&app)
}

#[tauri::command]
fn forget(app: AppHandle, url: String) -> Config {
    let origin = normalize(&url).unwrap_or(url);
    let mut c = load_config(&app);
    c.known.retain(|k| k != &origin);
    if c.last.as_deref() == Some(origin.as_str()) {
        c.last = None;
    }
    save_config(&app, &c);
    if let Some(e) = keychain(&origin) {
        let _ = e.delete_credential();
    }
    c
}

#[tauri::command]
async fn connect(app: AppHandle, state: State<'_, Shell>, url: String) -> Result<Info, String> {
    let origin = normalize(&url)?;
    let o2 = origin.clone();
    let info = tauri::async_runtime::spawn_blocking(move || version_of(&o2)).await.map_err(|e| e.to_string())??;
    if info.protocol != PROTOCOL {
        return Err(format!(
            "服务器的协议版本是 {}，这个客户端是 {}：请{}。",
            info.protocol,
            PROTOCOL,
            if info.protocol > PROTOCOL { "更新桌面客户端" } else { "更新服务器" }
        ));
    }
    let mut c = load_config(&app);
    c.known.retain(|k| k != &origin);
    c.known.insert(0, origin.clone());
    c.known.truncate(8);
    c.last = Some(origin.clone());
    save_config(&app, &c);

    // the game page may reach these three commands, from this origin only
    let n = state.caps.fetch_add(1, Ordering::Relaxed);
    app.add_capability(
        CapabilityBuilder::new(format!("game-{n}"))
            .remote(format!("{origin}/*"))
            .window("game")
            .permission("allow-key-store")
            .permission("allow-toggle-fullscreen")
            .permission("allow-switch-server"),
    )
    .map_err(|e| e.to_string())?;
    *state.origin.lock().unwrap() = Some(origin.clone());

    if let Some(w) = app.get_webview_window("game") {
        let _ = w.destroy();
    }
    let key = keychain(&origin).and_then(|e| e.get_password().ok());
    let target: url::Url = origin.parse().map_err(|_| "bad url".to_string())?;
    let stay = origin.clone();
    WebviewWindowBuilder::new(&app, "game", WebviewUrl::External(target))
        .title(format!("霍格沃茨 · {}", info.name))
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 500.0)
        .maximized(true)
        .initialization_script(&bridge_script(&origin, key.as_deref()))
        .on_navigation(move |u| {
            // the game window shows its server; anything else (GitHub, docs) opens in the system browser
            if u.origin().ascii_serialization() == stay {
                return true;
            }
            if u.scheme() == "http" || u.scheme() == "https" {
                let _ = tauri_plugin_opener::open_url(u.as_str(), None::<&str>);
            }
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    if let Some(l) = app.get_webview_window("launcher") {
        let _ = l.close();
    }
    Ok(info)
}

#[tauri::command]
fn key_store(webview: tauri::Webview, state: State<'_, Shell>, key: Option<String>) -> Result<(), String> {
    let origin = state.origin.lock().unwrap().clone().ok_or("no server")?;
    let here = webview.url().map_err(|e| e.to_string())?.origin().ascii_serialization();
    if here != origin {
        return Err("wrong origin".into());
    }
    let e = keychain(&origin).ok_or("no keychain")?;
    match key.filter(|k| !k.is_empty() && k.len() < 512) {
        Some(k) => e.set_password(&k).map_err(|e| e.to_string()),
        None => {
            let _ = e.delete_credential();
            Ok(())
        }
    }
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) {
    let full = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!full);
}

#[tauri::command]
async fn switch_server(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("launcher").is_none() {
        WebviewWindowBuilder::new(&app, "launcher", WebviewUrl::App("index.html?pick=1".into()))
            .title("霍格沃茨")
            .inner_size(880.0, 620.0)
            .min_inner_size(560.0, 460.0)
            .center()
            .build()
            .map_err(|e| e.to_string())?;
    }
    if let Some(w) = app.get_webview_window("game") {
        let _ = w.destroy();
    }
    Ok(())
}

/// This program as an MCP command line (an AppImage's own path, not its temporary mount).
fn exe_path() -> String {
    std::env::var("APPIMAGE").ok().filter(|p| !p.is_empty()).unwrap_or_else(|| std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default())
}

#[derive(Serialize)]
struct AgentInfo {
    exe: String,
    /// The command for Claude Code (also shown to copy).
    claude_code: String,
    /// Where Claude Desktop keeps its MCP servers, when it looks installed.
    claude_desktop: Option<String>,
    has_claude_cli: bool,
}

fn claude_desktop_config() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join("Claude").join("claude_desktop_config.json"))
}

fn has_cli(bin: &str) -> bool {
    std::process::Command::new(bin).arg("--version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

#[tauri::command]
fn agent_info() -> AgentInfo {
    let exe = exe_path();
    let cfg = claude_desktop_config().filter(|p| p.parent().map(|d| d.exists()).unwrap_or(false));
    AgentInfo {
        claude_code: format!("claude mcp add -s user hogwarts -- \"{exe}\" --mcp-stdio"),
        exe,
        claude_desktop: cfg.map(|p| p.display().to_string()),
        has_claude_cli: has_cli("claude"),
    }
}

/// Wire this program into an agent as the `hogwarts` MCP server: "claude-desktop" edits its config file (a
/// backup is kept next to it), "claude-code" runs `claude mcp add`. The key is never written anywhere: the
/// --mcp-stdio mode reads it from the keychain.
#[tauri::command]
fn agent_setup(target: String) -> Result<String, String> {
    let exe = exe_path();
    match target.as_str() {
        "claude-desktop" => {
            let path = claude_desktop_config().ok_or("找不到 Claude Desktop 的配置目录")?;
            let mut cfg: serde_json::Value = match std::fs::read(&path) {
                Ok(b) => {
                    let _ = std::fs::write(path.with_extension("json.bak"), &b);
                    serde_json::from_slice(&b).map_err(|_| format!("{} 不是合法的 JSON，没有改动它", path.display()))?
                }
                Err(_) => serde_json::json!({}),
            };
            if !cfg.is_object() {
                return Err(format!("{} 的格式不对，没有改动它", path.display()));
            }
            if !cfg.get("mcpServers").map(|v| v.is_object()).unwrap_or(false) {
                cfg["mcpServers"] = serde_json::json!({});
            }
            cfg["mcpServers"]["hogwarts"] = serde_json::json!({ "command": exe, "args": ["--mcp-stdio"] });
            if let Some(d) = path.parent() {
                std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, serde_json::to_vec_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
            Ok(format!("已写入 {}。重启 Claude Desktop，然后对它说「连上霍格沃茨」。", path.display()))
        }
        "claude-code" => {
            let _ = std::process::Command::new("claude").args(["mcp", "remove", "-s", "user", "hogwarts"]).output();
            let out = std::process::Command::new("claude")
                .args(["mcp", "add", "-s", "user", "hogwarts", "--", &exe, "--mcp-stdio"])
                .output()
                .map_err(|e| format!("运行 claude 失败（{e}）：把上面的命令复制到终端里执行"))?;
            if out.status.success() {
                Ok("已添加到 Claude Code（所有项目可用）。新开一个 claude 会话，对它说「连上霍格沃茨」。".into())
            } else {
                Err(format!("claude mcp add 失败：{}", String::from_utf8_lossy(&out.stderr).trim()))
            }
        }
        _ => Err("unknown target".into()),
    }
}

/// `--mcp-stdio`: see bridge.rs.
pub fn mcp_stdio(args: &[String]) {
    bridge::run(args)
}

/// The shell's keyboard shortcuts as the player sees them (the launcher's footer, the game's Owl Post): macOS keeps
/// F11 for itself (Show Desktop), so there it is the menu's own ⌃⌘F and ⇧⌘S.
#[derive(Serialize, Clone, Debug)]
pub struct Keys {
    full: &'static str,
    switch: &'static str,
}
const KEYS: Keys = if cfg!(target_os = "macos") { Keys { full: "⌃⌘F", switch: "⇧⌘S" } } else { Keys { full: "F11", switch: "Ctrl+Shift+S" } };

#[tauri::command]
fn keys() -> Keys {
    KEYS
}

/// macOS menu bar, in Chinese: the app menu (About / Hide / Quit), Edit (so ⌘C / ⌘V / ⌘Z reach the chat and the
/// spell editor), Game → switch server (⇧⌘S), View → native full screen (⌃⌘F), Window.
#[cfg(target_os = "macos")]
fn mac_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let about = AboutMetadata { name: Some("霍格沃茨".into()), version: Some(env!("CARGO_PKG_VERSION").into()), ..Default::default() };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "霍格沃茨",
                true,
                &[
                    &P::about(app, Some("关于霍格沃茨"), Some(about))?,
                    &P::separator(app)?,
                    &P::services(app, Some("服务"))?,
                    &P::separator(app)?,
                    &P::hide(app, Some("隐藏霍格沃茨"))?,
                    &P::hide_others(app, Some("隐藏其他"))?,
                    &P::show_all(app, Some("全部显示"))?,
                    &P::separator(app)?,
                    &P::quit(app, Some("退出霍格沃茨"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &P::undo(app, Some("撤销"))?,
                    &P::redo(app, Some("重做"))?,
                    &P::separator(app)?,
                    &P::cut(app, Some("剪切"))?,
                    &P::copy(app, Some("拷贝"))?,
                    &P::paste(app, Some("粘贴"))?,
                    &P::select_all(app, Some("全选"))?,
                ],
            )?,
            &Submenu::with_items(app, "游戏", true, &[&MenuItem::with_id(app, MENU_SWITCH, "换服务器…", true, Some("CmdOrCtrl+Shift+S"))?])?,
            &Submenu::with_items(app, "显示", true, &[&P::fullscreen(app, Some("进入全屏幕"))?])?,
            &Submenu::with_items(
                app,
                "窗口",
                true,
                &[&P::minimize(app, Some("最小化"))?, &P::maximize(app, Some("缩放"))?, &P::separator(app)?, &P::close_window(app, Some("关闭窗口"))?],
            )?,
        ],
    )
}
#[cfg(target_os = "macos")]
const MENU_SWITCH: &str = "switch-server";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(mac_menu).on_menu_event(|app, e| {
        if e.id() == MENU_SWITCH {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = switch_server(app).await;
            });
        }
    });
    builder
        .plugin(tauri_plugin_opener::init())
        .manage(Shell::default())
        .invoke_handler(tauri::generate_handler![discover, probe, saved, forget, connect, key_store, toggle_fullscreen, switch_server, agent_info, agent_setup, keys])
        .run(tauri::generate_context!())
        .expect("error while running the Hogwarts desktop client");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_become_origins() {
        assert_eq!(normalize("10.37.1.20").unwrap(), "http://10.37.1.20:7777");
        assert_eq!(normalize(" 10.37.1.20:8000/ ").unwrap(), "http://10.37.1.20:8000");
        assert_eq!(normalize("http://castle.lan").unwrap(), "http://castle.lan");
        assert_eq!(normalize("https://game.example.com/play").unwrap(), "https://game.example.com");
        assert!(normalize("").is_err());
        assert!(normalize("file:///etc/passwd").is_err());
        assert!(normalize("javascript:alert(1)").is_err());
    }

    #[test]
    fn finds_a_server_that_answers_the_probe() {
        let srv = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).unwrap();
        let port = srv.local_addr().unwrap().port();
        srv.set_read_timeout(Some(Duration::from_millis(800))).unwrap();
        std::thread::spawn(move || {
            let mut b = [0u8; 64];
            while let Ok((n, from)) = srv.recv_from(&mut b) {
                if &b[..n] == PROBE {
                    let _ = srv.send_to(br#"{"hogwarts":1,"name":"Test Castle","port":7777,"version":"0.1.0","build":"b1","protocol":1,"players":2}"#, from);
                }
            }
        });
        let f = find(port, Duration::from_millis(600));
        assert_eq!(f.len(), 1, "one server, however many interfaces it answered on");
        assert_eq!(f[0].info.name, "Test Castle");
        assert_eq!(f[0].info.players, 2);
        assert!(f[0].url.ends_with(":7777"));
    }

    #[test]
    fn the_bridge_only_acts_on_its_server() {
        let s = bridge_script("http://10.0.0.5:7777", Some("k\"</script>"));
        assert!(s.contains(r#"var O = "http://10.0.0.5:7777""#));
        assert!(s.contains("if (location.origin !== O) return;"));
        // the key is a JSON string literal: quotes are escaped, nothing breaks out of the script
        assert!(s.contains(r#"K = "k\"</script>""#));
        assert!(bridge_script("http://a:1", None).contains("K = null"));
        // the page is told the shortcuts of this platform (macOS: the menu's, since F11 is Show Desktop there)
        let want = if cfg!(target_os = "macos") { r#""switch":"⇧⌘S""# } else { r#""switch":"Ctrl+Shift+S""# };
        assert!(s.contains(want), "{s}");
    }
}

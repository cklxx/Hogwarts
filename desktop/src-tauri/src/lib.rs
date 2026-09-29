//! Hogwarts desktop micro-client.
//!
//! Two windows. The **launcher** (a local page, `ui/`) lists the servers on the LAN (the server's UDP discovery,
//! src/server/discovery.ts), the ones used before, and takes an address by hand. The **game** window loads the
//! chosen server's own page, so the game is always the server's version (its "游戏已更新" notice reloads it).
//!
//! What the shell adds to the browser game:
//! - the Owl Post key lives in the system keychain (per server) and is handed back to the page when it opens, so a
//!   reinstall or a wiped web profile still lands you in the world;
//! - F11 full screen, Ctrl+Shift+S back to the server list;
//! - links to other sites open in the system browser; the game window only ever shows its server.
//!
//! Safety: the game page may call exactly three commands (key_store, toggle_fullscreen, switch_server), granted at
//! runtime to that server's origin only, and key_store checks the caller's origin again.

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

fn config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("servers.json"))
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

fn keychain(origin: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, origin).ok()
}

/// Runs in the game page before its own scripts: hands the saved key back (only on that server's origin), keeps
/// the keychain in step with the page's key, and adds the shell's two shortcuts.
fn bridge_script(origin: &str, key: Option<&str>) -> String {
    let o = serde_json::to_string(origin).unwrap();
    let k = serde_json::to_string(&key).unwrap();
    let ls = serde_json::to_string(KEY_LS).unwrap();
    format!(
        r#"(function () {{
  var O = {o}, K = {k}, LS = {ls};
  if (location.origin !== O) return;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Shell::default())
        .invoke_handler(tauri::generate_handler![discover, probe, saved, forget, connect, key_store, toggle_fullscreen, switch_server])
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
    }
}

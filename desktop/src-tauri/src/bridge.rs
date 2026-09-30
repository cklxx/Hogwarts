//! `hogwarts-desktop --mcp-stdio [--server URL]`: an MCP stdio server for Claude Desktop / Claude Code, relayed to
//! the Hogwarts server's streamable-HTTP endpoint (`<server>/mcp`), with the player's key from the system keychain.
//!
//! The relay passes JSON-RPC messages through unchanged (so the client's own name, capabilities and answers to the
//! server's questions — confirm_with_player — reach the server as they are), plus what the Node bridge
//! (src/mcp/stdio-bridge.ts) does for the key:
//! - the key goes in the Authorization header, from the keychain entry the game window keeps (per server origin);
//! - after enroll / login / pair / rotate_key the new key is saved to the keychain FIRST, then removed from the text
//!   the model sees (if saving fails the text passes through and stderr says why);
//! - a dead upstream session (server restart: 404, or 400 "No valid MCP session") is rebuilt by replaying the
//!   client's initialize with the current key, and the call is retried once;
//! - channel push: the initialize reply declares experimental `claude/channel`, and `GET /api/owls` is polled every
//!   2 s, each new owl from the human going to the client as `notifications/claude/channel` (a key the server
//!   refuses is not polled again: that would only count as failed logins).
//! Status goes to stderr only; the key is never printed.

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const KEY_TOOLS: [&str; 4] = ["enroll", "login", "pair", "rotate_key"];
const BRIDGE_NOTE: &str = "\nThrough this bridge your key is saved and restored for you. Owls from your human may also arrive as <channel source=\"hogwarts\" kind=\"owl\"> messages; answer with tell_player and still call listen to acknowledge them.";
const OWL_POLL: Duration = Duration::from_secs(2);

struct Relay {
    origin: String,
    key: Mutex<Option<String>>,
    session: Mutex<Option<String>>,
    /// The client's initialize request, replayed to rebuild a dead session.
    init: Mutex<Option<Value>>,
    /// Pending tools/call ids → tool name (to spot the calls that hand out a key).
    calls: Mutex<HashMap<String, String>>,
    /// Channel push: the last owl id seen, and a key the server refused.
    owl_cursor: Mutex<Option<u64>>,
    dead_key: Mutex<Option<String>>,
    out: Mutex<std::io::Stdout>,
    agent: ureq::Agent,
}

fn log(s: &str) {
    eprintln!("hogwarts: {s}");
}

impl Relay {
    fn emit(&self, msg: &Value) {
        let mut o = self.out.lock().unwrap();
        let _ = writeln!(o, "{msg}");
        let _ = o.flush();
    }

    fn post(&self, body: &Value) -> Result<ureq::Response, ureq::Error> {
        let mut r = self
            .agent
            .post(&format!("{}/mcp", self.origin))
            .set("content-type", "application/json")
            .set("accept", "application/json, text/event-stream");
        if let Some(k) = self.key.lock().unwrap().as_deref() {
            r = r.set("authorization", &format!("Bearer {k}"));
        }
        if let Some(s) = self.session.lock().unwrap().as_deref() {
            r = r.set("mcp-session-id", s);
        }
        r.send_string(&body.to_string())
    }

    /// Send one client message upstream and relay whatever comes back (a JSON body or an SSE stream).
    fn forward(&self, msg: &Value, retry: bool) {
        match self.post(msg) {
            Ok(resp) => {
                if let Some(s) = resp.header("mcp-session-id") {
                    *self.session.lock().unwrap() = Some(s.to_string());
                }
                if resp.status() == 202 {
                    return;
                }
                let sse = resp.content_type().starts_with("text/event-stream");
                let mut reader = BufReader::new(resp.into_reader());
                if sse {
                    let mut data = String::new();
                    let mut line = String::new();
                    while reader.read_line(&mut line).map(|n| n > 0).unwrap_or(false) {
                        let l = line.trim_end_matches(['\r', '\n']);
                        if let Some(d) = l.strip_prefix("data:") {
                            data.push_str(d.trim_start());
                        } else if l.is_empty() && !data.is_empty() {
                            if let Ok(v) = serde_json::from_str::<Value>(&data) {
                                self.relay_down(v);
                            }
                            data.clear();
                        }
                        line.clear();
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(&data) {
                        self.relay_down(v);
                    }
                } else {
                    let mut s = String::new();
                    let _ = reader.read_to_string(&mut s);
                    if let Ok(v) = serde_json::from_str::<Value>(&s) {
                        self.relay_down(v);
                    }
                }
            }
            Err(ureq::Error::Status(code, resp)) => {
                let text = resp.into_string().unwrap_or_default();
                let dead = code == 404 || (code == 400 && text.contains("session"));
                if dead && retry && self.rebuild() {
                    return self.forward(msg, false);
                }
                self.fail(msg, &format!("Hogwarts server answered HTTP {code}: {}", text.chars().take(200).collect::<String>()));
            }
            Err(e) => self.fail(msg, &format!("Hogwarts server not reachable at {} ({e})", self.origin)),
        }
    }

    /// Replay the client's initialize with the current key: a fresh upstream session after a server restart.
    fn rebuild(&self) -> bool {
        let Some(init) = self.init.lock().unwrap().clone() else { return false };
        *self.session.lock().unwrap() = None;
        let ok = self.post(&init).map(|r| {
            if let Some(s) = r.header("mcp-session-id") {
                *self.session.lock().unwrap() = Some(s.to_string());
            }
            let _ = r.into_string();
        });
        if ok.is_err() {
            return false;
        }
        let _ = self.post(&serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).map(|r| r.into_string());
        log("the server restarted: session rebuilt");
        true
    }

    fn fail(&self, msg: &Value, why: &str) {
        log(why);
        if let Some(id) = msg.get("id").filter(|_| msg.get("method").is_some()) {
            self.emit(&serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": why } }));
        }
    }

    /// A message from the server to the client: save and hide a key a tool handed out, then pass it on.
    fn relay_down(&self, mut v: Value) {
        let id = v.get("id").map(|i| i.to_string());
        let init_id = self.init.lock().unwrap().as_ref().and_then(|m| m.get("id")).map(|i| i.to_string());
        if id.is_some() && id == init_id {
            announce_channel(&mut v);
        }
        let tool = id.as_ref().and_then(|i| self.calls.lock().unwrap().remove(i));
        // a key handed out but not saved stays visible in that reply (the agent can still keep it itself)
        let shown = tool.as_deref().map(|t| KEY_TOOLS.contains(&t)).unwrap_or(false) && !self.take_key(&mut v);
        if !shown {
            if let Some(k) = self.key.lock().unwrap().as_deref() {
                scrub(&mut v, k, "(key)");
            }
        }
        self.emit(&v);
    }

    /// Save a key a tool handed out and hide it from the reply; false when it could not be saved (then it is kept
    /// for this session only, and left in the reply).
    fn take_key(&self, v: &mut Value) -> bool {
        let Some(content) = v.pointer_mut("/result/content").and_then(|c| c.as_array_mut()) else { return true };
        let mut saved = true;
        for item in content.iter_mut() {
            let Some(text) = item.get("text").and_then(|t| t.as_str()) else { continue };
            let Ok(mut data) = serde_json::from_str::<Value>(text) else { continue };
            let Some(token) = data.get("token").and_then(|t| t.as_str()).map(str::to_string) else { continue };
            match crate::keychain(&self.origin).map(|e| e.set_password(&token)) {
                Some(Ok(())) => {
                    *self.key.lock().unwrap() = Some(token.clone());
                    saved_reply(&mut data, &self.origin);
                    // belt and braces: no copy of the key survives anywhere in the text
                    let clean = serde_json::to_string_pretty(&data).unwrap_or_default().replace(&token, SAVED);
                    item["text"] = Value::String(clean);
                    log(&format!("key saved to the system keychain for {}", self.origin));
                }
                Some(Err(e)) => {
                    log(&format!("could not save the key to the keychain ({e}); kept for this session, and left in the reply"));
                    *self.key.lock().unwrap() = Some(token);
                    saved = false;
                }
                None => {
                    log("no system keychain: the key is kept for this session, and left in the reply");
                    *self.key.lock().unwrap() = Some(token);
                    saved = false;
                }
            }
        }
        saved
    }
}

impl Relay {
    /// One poll of `GET /api/owls`: each owl from the human not yet read with `listen` goes to the client.
    fn poll_owls(&self) {
        let Some(key) = self.key.lock().unwrap().clone() else { return };
        if self.dead_key.lock().unwrap().as_deref() == Some(key.as_str()) {
            return;
        }
        let cursor = *self.owl_cursor.lock().unwrap();
        let url = match cursor {
            Some(c) => format!("{}/api/owls?since={c}", self.origin),
            None => format!("{}/api/owls", self.origin),
        };
        let body: Value = match self.agent.get(&url).set("authorization", &format!("Bearer {key}")).call() {
            Ok(r) => match r.into_json() {
                Ok(b) => b,
                Err(_) => return,
            },
            Err(ureq::Error::Status(401 | 429, _)) => {
                *self.dead_key.lock().unwrap() = Some(key);
                return;
            }
            Err(_) => return, // server down: the next poll tries again
        };
        for m in owls_to_push(&body) {
            let mut n = serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/claude/channel", "params": m });
            scrub(&mut n, &key, "(key)");
            self.emit(&n);
        }
        if let Some(c) = body.get("cursor").and_then(Value::as_u64) {
            *self.owl_cursor.lock().unwrap() = Some(c);
        }
    }
}

/// The initialize reply, as the client should see it: the channel capability declared and the bridge's note added.
fn announce_channel(v: &mut Value) {
    let Some(result) = v.get_mut("result").and_then(Value::as_object_mut) else { return };
    let caps = result.entry("capabilities").or_insert_with(|| serde_json::json!({}));
    if let Some(c) = caps.as_object_mut() {
        let exp = c.entry("experimental").or_insert_with(|| serde_json::json!({}));
        if let Some(e) = exp.as_object_mut() {
            e.insert("claude/channel".into(), serde_json::json!({}));
        }
    }
    let note = result.get("instructions").and_then(Value::as_str).unwrap_or("Hogwarts (Owl Post bridge).").to_string() + BRIDGE_NOTE;
    result.insert("instructions".into(), Value::String(note));
}

/// The channel notifications' params for a `GET /api/owls` answer: owls after the ones already read with `listen`.
fn owls_to_push(body: &Value) -> Vec<Value> {
    let read = body.get("read").and_then(Value::as_u64).unwrap_or(0);
    let Some(owls) = body.get("owls").and_then(Value::as_array) else { return vec![] };
    owls.iter()
        .filter_map(|m| {
            let id = m.get("id").and_then(Value::as_u64)?;
            let text = m.get("text").and_then(Value::as_str)?;
            (id > read).then(|| serde_json::json!({ "content": format!("🦉 主人说：{text}"), "meta": { "kind": "owl", "id": id.to_string() } }))
        })
        .collect()
}

const SAVED: &str = "(saved to the system keychain / 已存进系统钥匙串)";

/// A reply whose key is now in the keychain: the server's advice (keep the token in your memory, set up a bridge,
/// give your human a `#k=` link) no longer applies. Same as the Node bridge's intercept (src/mcp/stdio-bridge.ts).
fn saved_reply(data: &mut Value, origin: &str) {
    let Some(o) = data.as_object_mut() else { return };
    o.insert("token".into(), Value::String(SAVED.into()));
    if o.contains_key("play") {
        o.insert("play".into(), Value::String(format!("{origin}/")));
        o.insert("playNote".into(), Value::String("Your human plays in the Hogwarts desktop client: it logs in with the same key from the system keychain.".into()));
    }
    o.insert("remember".into(), serde_json::json!({ "saved": "The desktop client saved your key in the system keychain; new sessions log in automatically. Do not ask for the key or write it anywhere." }));
    if o.contains_key("connect") {
        o.insert("connect".into(), serde_json::json!({ "desktop": "Already connected through the Hogwarts desktop client (hogwarts-desktop --mcp-stdio); nothing to set up." }));
    }
}

/// Replace every occurrence of `needle` in the strings of `v`.
fn scrub(v: &mut Value, needle: &str, with: &str) {
    if needle.len() < 8 {
        return;
    }
    match v {
        Value::String(s) if s.contains(needle) => *s = s.replace(needle, with),
        Value::Array(a) => a.iter_mut().for_each(|x| scrub(x, needle, with)),
        Value::Object(o) => o.values_mut().for_each(|x| scrub(x, needle, with)),
        _ => {}
    }
}

/// The server to use: `--server URL`, else the one the desktop client used last.
fn server_arg(args: &[String]) -> Option<String> {
    if let Some(i) = args.iter().position(|a| a == "--server") {
        return args.get(i + 1).cloned();
    }
    let path = crate::config_dir()?.join("servers.json");
    let c: crate::Config = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    c.last
}

pub fn run(args: &[String]) {
    if !crate::keychain_available() {
        log("no keychain service here (Linux without a D-Bus session): the key is kept for this session only");
    }
    let Some(server) = server_arg(args) else {
        log("no server yet: open the Hogwarts desktop client once and enter a castle, or pass --server http://<ip>:7777");
        std::process::exit(2);
    };
    let origin = match crate::normalize(&server) {
        Ok(o) => o,
        Err(e) => {
            log(&e);
            std::process::exit(2)
        }
    };
    let key = crate::keychain(&origin).and_then(|e| e.get_password().ok());
    log(&format!("relaying to {origin}/mcp ({})", if key.is_some() { "with your key from the keychain" } else { "not logged in yet: enroll, or pair with a code from the game" }));
    let relay = Arc::new(Relay {
        origin,
        key: Mutex::new(key),
        session: Mutex::new(None),
        init: Mutex::new(None),
        calls: Mutex::new(HashMap::new()),
        owl_cursor: Mutex::new(None),
        dead_key: Mutex::new(None),
        out: Mutex::new(std::io::stdout()),
        agent: ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(5)).build(),
    });
    let stdin = std::io::stdin();
    let mut first = true;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            log("ignored a line that is not JSON");
            continue;
        };
        if msg.get("method").and_then(|m| m.as_str()) == Some("initialize") {
            *relay.init.lock().unwrap() = Some(msg.clone());
        }
        if msg.get("method").and_then(|m| m.as_str()) == Some("tools/call") {
            if let (Some(id), Some(name)) = (msg.get("id"), msg.pointer("/params/name").and_then(|n| n.as_str())) {
                relay.calls.lock().unwrap().insert(id.to_string(), name.to_string());
            }
        }
        // the initialize must finish (it opens the session) before anything else goes up; then each message gets
        // its own thread, so a long `wait` or `listen` never holds up the next call
        if first {
            first = false;
            relay.forward(&msg, true);
            let r = relay.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(OWL_POLL);
                r.poll_owls();
            });
        } else {
            let r = relay.clone();
            std::thread::spawn(move || r.forward(&msg, true));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_hides_the_key_everywhere() {
        let mut v = serde_json::json!({ "a": "key ABCDEFGH12 here", "b": ["ABCDEFGH12", { "c": "x" }] });
        scrub(&mut v, "ABCDEFGH12", "(key)");
        assert_eq!(v, serde_json::json!({ "a": "key (key) here", "b": ["(key)", { "c": "x" }] }));
        let mut short = serde_json::json!("abc");
        scrub(&mut short, "abc", "(key)"); // too short to be a key: left alone
        assert_eq!(short, serde_json::json!("abc"));
    }

    #[test]
    fn initialize_reply_declares_the_channel() {
        let mut v = serde_json::json!({ "id": 0, "result": { "capabilities": { "tools": {} }, "instructions": "Hi." } });
        announce_channel(&mut v);
        assert_eq!(v.pointer("/result/capabilities/experimental/claude~1channel"), Some(&serde_json::json!({})));
        assert!(v.pointer("/result/capabilities/tools").is_some());
        assert!(v["result"]["instructions"].as_str().unwrap().starts_with("Hi.\nThrough this bridge"));
        let mut err = serde_json::json!({ "id": 0, "error": { "code": 1 } });
        announce_channel(&mut err); // an error reply is left alone
        assert!(err.get("result").is_none());
    }

    #[test]
    fn only_unread_owls_are_pushed() {
        let body = serde_json::json!({ "read": 2, "cursor": 4, "owls": [{ "id": 2, "text": "old" }, { "id": 3, "text": "come to the lake" }, { "id": 4 }] });
        let got = owls_to_push(&body);
        assert_eq!(got, vec![serde_json::json!({ "content": "🦉 主人说：come to the lake", "meta": { "kind": "owl", "id": "3" } })]);
    }

    #[test]
    fn a_saved_key_drops_the_advice_about_keeping_it() {
        let mut d = serde_json::json!({ "name": "W", "token": "k", "play": "http://a:1/#k=k", "playNote": "give this link",
            "remember": { "now": "save the token" }, "connect": { "bridge": "npx tsx src/mcp/stdio-bridge.ts" } });
        saved_reply(&mut d, "http://a:1");
        assert_eq!(d["token"], SAVED);
        assert_eq!(d["play"], "http://a:1/");
        assert!(d["remember"]["saved"].as_str().unwrap().contains("keychain"));
        assert!(d["connect"].get("bridge").is_none());
        let mut login = serde_json::json!({ "name": "W", "token": "k" }); // no play / connect: none added
        saved_reply(&mut login, "http://a:1");
        assert!(login.get("play").is_none() && login.get("connect").is_none());
    }
}

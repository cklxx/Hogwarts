//! Dev helper for testing the keychain bridge: `cargo run --example keytool -- get|set|del <origin> [key]`.
//! Uses the same keyring entry as the app (service "hogwarts-desktop", one entry per server origin).
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let (cmd, origin) = (a.first().map(String::as_str).unwrap_or(""), a.get(1).cloned().unwrap_or_default());
    let e = keyring::Entry::new("hogwarts-desktop", &origin).expect("keyring entry");
    match cmd {
        "get" => match e.get_password() { Ok(k) => println!("{k}"), Err(err) => { eprintln!("none ({err})"); std::process::exit(1) } },
        "set" => e.set_password(a.get(2).expect("key")).expect("set"),
        "del" => { let _ = e.delete_credential(); }
        _ => { eprintln!("usage: keytool get|set|del <origin> [key]"); std::process::exit(2) }
    }
}

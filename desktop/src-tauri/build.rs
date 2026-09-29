fn main() {
    // App commands get permissions (allow-<command>) so each window only reaches the ones its capability lists:
    // the launcher (local page) everything but the game-page bridge; the game page (the server's origin, added at
    // runtime) only key_store, toggle_fullscreen and switch_server.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "discover",
        "probe",
        "connect",
        "saved",
        "forget",
        "key_store",
        "toggle_fullscreen",
        "switch_server",
    ])))
    .expect("tauri build script");
}

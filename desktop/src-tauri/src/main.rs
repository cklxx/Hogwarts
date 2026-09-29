// no console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `--mcp-stdio`: an MCP server for Claude Desktop / Claude Code instead of the window (src/bridge.rs)
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--mcp-stdio") {
        return hogwarts_desktop_lib::mcp_stdio(&args);
    }
    hogwarts_desktop_lib::run()
}

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use env_logger;
use log;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if app_lib::google_meet::protocol::is_native_host_invocation(&args) {
        std::process::exit(app_lib::google_meet::native_host::run_stdio());
    }

    std::env::set_var("RUST_LOG", "info");
    env_logger::init();

    // Async logger will be initialized lazily when first needed (after Tauri runtime starts)
    log::info!("Starting application...");
    app_lib::run();
}

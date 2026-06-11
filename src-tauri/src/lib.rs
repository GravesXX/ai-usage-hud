mod commands;
mod desktop_pin;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            tray::setup(app.handle())?;
            let win = app.get_webview_window("main").expect("main window");
            if let Err(e) = desktop_pin::apply_mode(&win, "pinned") {
                eprintln!("desktop pin failed (window stays at normal level): {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_keychain,
            commands::check_processes,
            commands::get_cli_version,
            commands::set_window_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

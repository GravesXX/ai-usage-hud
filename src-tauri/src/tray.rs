use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

static FLOAT: AtomicBool = AtomicBool::new(false);
static ARRANGING: AtomicBool = AtomicBool::new(false);

fn current_mode() -> &'static str {
    if ARRANGING.load(Ordering::SeqCst) {
        "arrange"
    } else if FLOAT.load(Ordering::SeqCst) {
        "float"
    } else {
        "pinned"
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let arrange = CheckMenuItem::with_id(app, "arrange", "Arrange (drag to move)", true, false, None::<&str>)?;
    let float = CheckMenuItem::with_id(app, "float", "Float on top", true, false, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Launch at login", true, autostart_enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .items(&[&arrange, &float, &refresh, &autostart, &quit])
        .build()?;

    let arrange_c = arrange.clone();
    let float_c = float.clone();
    let autostart_c = autostart.clone();

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("bundled icon").clone())
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let win = app.get_webview_window("main").expect("main window");
            match event.id().as_ref() {
                "arrange" => {
                    let new = !ARRANGING.load(Ordering::SeqCst);
                    ARRANGING.store(new, Ordering::SeqCst);
                    let _ = arrange_c.set_checked(new);
                    let _ = crate::desktop_pin::apply_mode(&win, current_mode());
                }
                "float" => {
                    let new = !FLOAT.load(Ordering::SeqCst);
                    FLOAT.store(new, Ordering::SeqCst);
                    let _ = float_c.set_checked(new);
                    let _ = crate::desktop_pin::apply_mode(&win, current_mode());
                }
                "refresh" => {
                    let _ = app.emit("tray-action", "refresh");
                }
                "autostart" => {
                    let al = app.autolaunch();
                    let enabled = al.is_enabled().unwrap_or(false);
                    let _ = if enabled { al.disable() } else { al.enable() };
                    let _ = autostart_c.set_checked(!enabled);
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

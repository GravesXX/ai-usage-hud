use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool};
use tauri::WebviewWindow;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
}

const KEY_DESKTOP: i32 = 2; // kCGDesktopWindowLevelKey  -> level ~ -2147483623
const KEY_NORMAL: i32 = 4; // kCGNormalWindowLevelKey   -> level 0
const KEY_FLOATING: i32 = 5; // kCGFloatingWindowLevelKey -> level 3

fn apply(window: &WebviewWindow, level: i64, ignore_mouse: bool) -> Result<(), String> {
    // Transmit pointer as usize so the closure is Send (usize: Send).
    // SAFETY: The pointer is only dereferenced on the main thread inside run_on_main_thread.
    let raw_ptr: usize = window.ns_window().map_err(|e| e.to_string())? as usize;
    window
        .run_on_main_thread(move || unsafe {
            let w = raw_ptr as *mut AnyObject;
            let _: () = msg_send![w, setLevel: level as isize];
            // CanJoinAllSpaces(1<<0) | Stationary(1<<4) | IgnoresCycle(1<<6)
            // Stationary: survives Mission Control / Show Desktop. (Übersicht's exact recipe.)
            let behavior: usize = (1 << 0) | (1 << 4) | (1 << 6);
            let _: () = msg_send![w, setCollectionBehavior: behavior];
            let _: () = msg_send![w, setIgnoresMouseEvents: Bool::new(ignore_mouse)];
        })
        .map_err(|e| e.to_string())
}

/// pinned: wallpaper layer, click-through. float: above all apps, interactive.
/// arrange: just below normal windows, interactive (for dragging into place).
pub fn apply_mode(window: &WebviewWindow, mode: &str) -> Result<(), String> {
    let (level, ignore_mouse) = unsafe {
        match mode {
            "pinned" => (CGWindowLevelForKey(KEY_DESKTOP) as i64, true),
            "float" => (CGWindowLevelForKey(KEY_FLOATING) as i64, false),
            "arrange" => (CGWindowLevelForKey(KEY_NORMAL) as i64 - 1, false),
            _ => return Err(format!("unknown mode: {mode}")),
        }
    };
    apply(window, level, ignore_mouse)
}

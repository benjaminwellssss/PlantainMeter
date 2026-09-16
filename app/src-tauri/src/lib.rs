mod accent;
mod commands;
mod edition;
mod fx;
mod hotkeys;
mod voicemeeter;

use commands::VmState;
use fx::FxState;
use hotkeys::ShortcutMap;
use std::sync::atomic::{AtomicBool, AtomicU8};
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_global_shortcut::ShortcutState;

pub struct WindowState {
    pub window: Mutex<Option<WebviewWindow>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        hotkeys::handle_shortcut(app, &shortcut.to_string());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(VmState {
            api: Mutex::new(None),
            polling: Arc::new(AtomicBool::new(false)),
            connected: Arc::new(AtomicBool::new(false)),
            edition: AtomicU8::new(0),
        })
        .manage(ShortcutMap::default())
        .manage(FxState::default())
        .manage(WindowState {
            window: Mutex::new(None),
        })
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window");

            // Store window handle for runtime acrylic toggling
            let ws: tauri::State<WindowState> = app.state();
            *ws.window.lock().unwrap() = Some(window.clone());

            // Apply acrylic glass effect by default
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                let _ = apply_acrylic(&window, Some((10, 10, 10, 255)));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vm_login,
            commands::vm_logout,
            commands::vm_set_gain,
            commands::vm_set_mute,
            commands::vm_get_all_strips,
            commands::vm_set_a1_device,
            commands::vm_get_a1_device,
            commands::vm_restart_engine,
            commands::vm_run_voicemeeter,
            commands::vm_list_installed_editions,
            commands::vm_get_edition,
            commands::vm_list_output_devices,
            commands::get_accent_color,
            commands::set_acrylic,
            commands::set_window_opacity,
            hotkeys::vm_sync_shortcuts,
            fx::vm_sync_fx_groups,
            fx::vm_toggle_fx_group,
            fx::vm_get_fx_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

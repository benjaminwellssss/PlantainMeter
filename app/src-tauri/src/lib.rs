mod accent;
mod commands;
mod voicemeeter;

use commands::{ShortcutMap, VmState};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
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
                        let shortcut_str = shortcut.to_string();
                        let sm: tauri::State<ShortcutMap> = app.state();
                        let strip = {
                            let Ok(map) = sm.map.lock() else { return };
                            match map.get(&shortcut_str) {
                                Some(&s) => s,
                                None => return,
                            }
                        };
                        // ShortcutMap lock released — now acquire the VM lock
                        let vs: tauri::State<VmState> = app.state();
                        let Ok(guard) = vs.api.lock() else { return };
                        if let Some(ref api) = *guard {
                            let param = format!("Strip[{strip}].Mute");
                            let current = api.get_float(&param).unwrap_or(0.0);
                            let new_val = if current >= 1.0 { 0.0 } else { 1.0 };
                            let _ = api.set_float(&param, new_val);
                        }
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
        })
        .manage(ShortcutMap {
            map: Mutex::new(HashMap::new()),
        })
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
            commands::vm_set_mono,
            commands::vm_set_solo,
            commands::vm_set_mc,
            commands::vm_set_karaoke,
            commands::vm_get_all_strips,
            commands::vm_set_a1_device,
            commands::vm_get_a1_device,
            commands::vm_restart_engine,
            commands::vm_run_voicemeeter,
            commands::vm_list_output_devices,
            commands::get_accent_color,
            commands::set_acrylic,
            commands::set_window_opacity,
            commands::vm_sync_shortcuts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

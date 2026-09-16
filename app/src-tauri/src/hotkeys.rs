//! Global hotkey bindings and dispatch.
//!
//! A binding maps a normalized accelerator string to a `HotkeyAction`. The
//! frontend owns the list (mute hotkeys from channel config plus FX group
//! hotkeys) and re-syncs the whole set whenever it changes; `vm_sync_shortcuts`
//! is the only place that unregisters everything, so mute and FX hotkeys must
//! always be synced together.
//!
//! Lock order: `ShortcutMap` is always released before touching `FxState` or
//! `VmState.api`. `FxState` is taken before `VmState.api`, never the reverse.

use crate::commands::VmState;
use crate::fx;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HotkeyAction {
    ToggleMute { strip: u32 },
    ToggleFxGroup { id: String },
}

#[derive(Clone, Debug, Deserialize)]
pub struct HotkeyBinding {
    pub hotkey: String,
    pub action: HotkeyAction,
}

/// Normalized accelerator string -> action.
pub struct ShortcutMap {
    pub map: Mutex<HashMap<String, HotkeyAction>>,
}

impl Default for ShortcutMap {
    fn default() -> Self {
        Self { map: Mutex::new(HashMap::new()) }
    }
}

/// Called from the global-shortcut plugin handler on key press.
pub fn handle_shortcut(app: &AppHandle, shortcut_str: &str) {
    let action = {
        let sm: tauri::State<ShortcutMap> = app.state();
        let Ok(map) = sm.map.lock() else { return };
        match map.get(shortcut_str) {
            Some(a) => a.clone(),
            None => return,
        }
    };
    // ShortcutMap lock released — now dispatch.
    dispatch(app, action);
}

fn dispatch(app: &AppHandle, action: HotkeyAction) {
    match action {
        HotkeyAction::ToggleMute { strip } => toggle_mute(app, strip),
        HotkeyAction::ToggleFxGroup { id } => {
            if let Err(e) = fx::toggle_group(app, &id) {
                eprintln!("FX group '{id}' toggle failed: {e}");
            }
        }
    }
}

fn toggle_mute(app: &AppHandle, strip: u32) {
    let vs: tauri::State<VmState> = app.state();
    let Ok(guard) = vs.api.lock() else { return };
    if let Some(ref api) = *guard {
        let param = format!("Strip[{strip}].Mute");
        let current = api.get_float(&param).unwrap_or(0.0);
        let new_val = if current >= 1.0 { 0.0 } else { 1.0 };
        let _ = api.set_float(&param, new_val);
    }
}

/// Replace every registered global shortcut with `bindings`.
#[tauri::command]
pub fn vm_sync_shortcuts(
    app: AppHandle,
    shortcut_map: tauri::State<ShortcutMap>,
    bindings: Vec<HotkeyBinding>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|e| format!("{e:?}"))?;

    let mut map = shortcut_map.map.lock().map_err(|e| e.to_string())?;
    map.clear();

    for binding in bindings {
        if binding.hotkey.is_empty() {
            continue;
        }
        let shortcut = match binding.hotkey.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to parse shortcut '{}': {e:?}", binding.hotkey);
                continue;
            }
        };
        let normalized = shortcut.to_string();
        if map.contains_key(&normalized) {
            eprintln!(
                "Shortcut '{}' is bound twice; keeping the first binding",
                binding.hotkey
            );
            continue;
        }
        match manager.register(shortcut) {
            Ok(_) => {
                map.insert(normalized, binding.action);
            }
            Err(e) => eprintln!("Failed to register shortcut '{}': {e:?}", binding.hotkey),
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actions_round_trip_through_json() {
        let mute: HotkeyAction =
            serde_json::from_str(r#"{"type":"toggleMute","strip":3}"#).unwrap();
        assert_eq!(mute, HotkeyAction::ToggleMute { strip: 3 });

        let fx: HotkeyAction =
            serde_json::from_str(r#"{"type":"toggleFxGroup","id":"abc"}"#).unwrap();
        assert_eq!(fx, HotkeyAction::ToggleFxGroup { id: "abc".into() });

        let back = serde_json::to_string(&fx).unwrap();
        assert!(back.contains(r#""type":"toggleFxGroup""#));
    }

    #[test]
    fn binding_deserializes() {
        let b: HotkeyBinding = serde_json::from_str(
            r#"{"hotkey":"CmdOrCtrl+Shift+M","action":{"type":"toggleMute","strip":0}}"#,
        )
        .unwrap();
        assert_eq!(b.hotkey, "CmdOrCtrl+Shift+M");
        assert_eq!(b.action, HotkeyAction::ToggleMute { strip: 0 });
    }
}

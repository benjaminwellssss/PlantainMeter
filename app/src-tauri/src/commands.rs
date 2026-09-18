use crate::accent::{get_system_accent_color, AccentColor};
use crate::voicemeeter::{LoginStatus, VoicemeeterAPI, VoicemeeterEdition};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::WindowState;

pub struct VmState {
    pub api: Mutex<Option<VoicemeeterAPI>>,
    pub polling: Arc<AtomicBool>,
    /// Whether the audio engine is currently reachable. Maintained by the polling
    /// thread, which is the only thing that can observe Voicemeeter coming back.
    pub connected: Arc<AtomicBool>,
    /// Which Voicemeeter edition is actually running (Standard/Banana/Potato).
    /// Strip/bus counts and channel layout differ per edition, so this is set
    /// once on every fresh connect (vm_login and the poller's recovery path)
    /// and read by everything that needs to know the strip/bus layout.
    pub edition: Arc<Mutex<Option<VoicemeeterEdition>>>,
}

/// Strip counts as (hardware, virtual) for the given edition — see
/// VoicemeeterEdition::strip_counts. Falls back to Potato's layout (the
/// superset) if the edition hasn't been detected yet, so a stray call before
/// the first successful login degrades gracefully instead of panicking.
fn edition_or_default(edition: &Mutex<Option<VoicemeeterEdition>>) -> VoicemeeterEdition {
    edition.lock().ok().and_then(|g| *g).unwrap_or(VoicemeeterEdition::Potato)
}

/// Every input strip index for the given edition, hardware then virtual.
fn monitored_strips(edition: VoicemeeterEdition) -> Vec<u32> {
    let (hw, virt) = edition.strip_counts();
    (0..hw + virt).collect()
}

/// Connection state reported to the frontend.
///
/// `Waiting` is a normal, recoverable state: Voicemeeter is not running yet
/// (autostart race) or the audio engine is mid-restart (device switch).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum VmConnection {
    Connected,
    Waiting,
}

/// Maps normalized shortcut strings to Voicemeeter strip indices.
pub struct ShortcutMap {
    pub map: Mutex<HashMap<String, u32>>,
}

#[derive(Debug, Deserialize)]
pub struct MuteShortcutConfig {
    pub strip: u32,
    pub hotkey: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StripState {
    pub strip: u32,
    pub gain: f32,
    pub muted: bool,
    pub mono: bool,
    /// "Mute Center" — virtual strips only.
    pub mc: bool,
    /// Solo.
    pub solo: bool,
    /// Karaoke mode, 0-4 — virtual strips only (K, K-M, K-1, K-2, center-scoop).
    pub karaoke: i32,
    /// Send level into the internal Reverb/Delay FX, 0-10 — every strip on
    /// Banana and Potato (not Standard, which has no FX section). `None`
    /// when this edition has no FX section at all.
    pub reverb_send: Option<f32>,
    pub delay_send: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AllStripsState {
    pub strips: Vec<StripState>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StripLevel {
    pub strip: u32,
    pub level: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AllStripLevels {
    pub levels: Vec<StripLevel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BusLevel {
    pub bus: u32,
    pub level: f32,
    pub gain: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AllBusLevels {
    pub levels: Vec<BusLevel>,
}

/// Maps strip index to its first L/R channel pair for GetLevel.
/// Hardware input strips are always 2 channels (stereo); virtual input strips
/// are always 8 channels (they carry multichannel app audio) — true across
/// every edition, only the strip *counts* differ. So Banana's virtual strips
/// start right after its 3 hardware strips (base 6), Potato's after its 5
/// (base 10), etc. — this generalizes what was previously a hardcoded Potato
/// table.
fn strip_to_channels(edition: VoicemeeterEdition, strip: u32) -> (i32, i32) {
    let (hw, _virt) = edition.strip_counts();
    let base: i32 = if strip < hw {
        (strip * 2) as i32
    } else {
        (hw * 2) as i32 + ((strip - hw) * 8) as i32
    };
    (base, base + 1)
}

fn read_bus_level(api: &VoicemeeterAPI, bus: u32) -> BusLevel {
    let base = (bus * 8) as i32;
    let level_l = api.get_level(3, base).unwrap_or(0.0);
    let level_r = api.get_level(3, base + 1).unwrap_or(0.0);
    let gain = api.get_float(&format!("Bus[{bus}].Gain")).unwrap_or(0.0);
    BusLevel { bus, level: level_l.max(level_r), gain }
}

fn read_strip_level(api: &VoicemeeterAPI, edition: VoicemeeterEdition, strip: u32) -> StripLevel {
    let (ch_l, ch_r) = strip_to_channels(edition, strip);
    let level_l = api.get_level(1, ch_l).unwrap_or(0.0);
    let level_r = api.get_level(1, ch_r).unwrap_or(0.0);
    StripLevel { strip, level: level_l.max(level_r) }
}

fn read_strip(api: &VoicemeeterAPI, edition: VoicemeeterEdition, strip: u32) -> StripState {
    let gain = api.get_float(&format!("Strip[{strip}].Gain")).unwrap_or(0.0);
    let mute_val = api.get_float(&format!("Strip[{strip}].Mute")).unwrap_or(0.0);
    let mono_val = api.get_float(&format!("Strip[{strip}].Mono")).unwrap_or(0.0);
    let mc_val = api.get_float(&format!("Strip[{strip}].MC")).unwrap_or(0.0);
    let solo_val = api.get_float(&format!("Strip[{strip}].Solo")).unwrap_or(0.0);
    let karaoke_val = api.get_float(&format!("Strip[{strip}].K")).unwrap_or(0.0);

    // Reverb/Delay sends — every strip on Banana and Potato.
    let (reverb_send, delay_send) = if edition.has_fx_sends() {
        (
            api.get_float(&format!("Strip[{strip}].Reverb")).ok(),
            api.get_float(&format!("Strip[{strip}].Delay")).ok(),
        )
    } else {
        (None, None)
    };

    StripState {
        strip,
        gain,
        muted: mute_val >= 1.0,
        mono: mono_val >= 1.0,
        mc: mc_val >= 1.0,
        solo: solo_val >= 1.0,
        karaoke: karaoke_val.round() as i32,
        reverb_send,
        delay_send,
    }
}

/// Current connection state as last observed by the polling thread.
fn current_connection(state: &VmState) -> VmConnection {
    if state.connected.load(Ordering::SeqCst) {
        VmConnection::Connected
    } else {
        VmConnection::Waiting
    }
}

/// Connect to Voicemeeter and make sure the polling thread is running.
///
/// Safe to call repeatedly: if the API handle already exists this just re-reports
/// status and revives the poller if it stopped. A `Waiting` result is not a failure --
/// the poller emits `vm:connection` once Voicemeeter appears.
#[tauri::command]
pub fn vm_login(state: State<VmState>, app: AppHandle) -> Result<VmConnection, String> {
    {
        let mut guard = state.api.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let mut api = VoicemeeterAPI::new()?;
            // rc == 1 means "logged in, but Voicemeeter is not running" -- a valid
            // handle we keep so the poller can detect the app starting up later.
            let status = api.login()?;
            if status == LoginStatus::Connected {
                if let Ok(ed) = api.voicemeeter_type() {
                    *state.edition.lock().map_err(|e| e.to_string())? = Some(ed);
                }
            }
            *guard = Some(api);
            state
                .connected
                .store(status == LoginStatus::Connected, Ordering::SeqCst);
        }
    }

    // Spawn the poller only on a genuine false -> true transition.
    if state
        .polling
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        spawn_poller(state.polling.clone(), app.clone());
    }

    Ok(current_connection(&state))
}

fn spawn_poller(polling: Arc<AtomicBool>, app_handle: AppHandle) {
    thread::spawn(move || {
        // Emit only on transitions, not every tick.
        let mut last_healthy: Option<bool> = None;

        while polling.load(Ordering::SeqCst) {
            let mut healthy = false;

            {
                let vm_state: State<VmState> = app_handle.state();
                // Bind the lock result before matching: an `if let` scrutinee temporary
                // would outlive `vm_state` and fail to borrow-check.
                let guard = vm_state.api.lock();
                if let Ok(ref lock) = guard {
                    if let Some(ref api) = **lock {
                        match api.is_dirty() {
                            Ok(dirty) => {
                                healthy = true;
                                // Resync fully when the engine comes back, otherwise the
                                // UI keeps showing pre-restart gains.
                                let recovered = last_healthy != Some(true);

                                if recovered {
                                    // Edition can only be read once the engine is actually
                                    // up, and a reconnect can in principle be a different
                                    // edition (Voicemeeter relaunched after being switched).
                                    if let Ok(ed) = api.voicemeeter_type() {
                                        if let Ok(mut slot) = vm_state.edition.lock() {
                                            *slot = Some(ed);
                                        }
                                    }
                                }
                                let edition = edition_or_default(&vm_state.edition);
                                let strips_list = monitored_strips(edition);

                                if dirty || recovered {
                                    let strips: Vec<StripState> = strips_list
                                        .iter()
                                        .map(|&s| read_strip(api, edition, s))
                                        .collect();
                                    let _ = app_handle
                                        .emit("vm:state-update", AllStripsState { strips });
                                }

                                // Always read levels (they change continuously)
                                let levels: Vec<StripLevel> = strips_list
                                    .iter()
                                    .map(|&s| read_strip_level(api, edition, s))
                                    .collect();
                                let _ = app_handle.emit("vm:levels", AllStripLevels { levels });

                                // Read output bus levels (A1 = Bus[0])
                                let bus_levels = vec![read_bus_level(api, 0)];
                                let _ = app_handle
                                    .emit("vm:bus-levels", AllBusLevels { levels: bus_levels });
                            }
                            // IsParametersDirty returns -2 ("no server") while the engine
                            // restarts and while Voicemeeter is not running. Both are
                            // transient: back off and keep watching. Breaking here would
                            // strand the UI permanently, since nothing else revives it.
                            Err(_) => {}
                        }
                    }
                }
                drop(guard);
            }

            if last_healthy != Some(healthy) {
                last_healthy = Some(healthy);
                let vm_state: State<VmState> = app_handle.state();
                vm_state.connected.store(healthy, Ordering::SeqCst);
                let payload = if healthy {
                    VmConnection::Connected
                } else {
                    VmConnection::Waiting
                };
                let _ = app_handle.emit("vm:connection", payload);
            }

            // ~30fps while live; back off while waiting so we do not spin on a dead API.
            thread::sleep(Duration::from_millis(if healthy { 33 } else { 250 }));
        }

        // The loop exits only via vm_logout.
        let vm_state: State<VmState> = app_handle.state();
        vm_state.connected.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
pub fn vm_logout(state: State<VmState>) -> Result<String, String> {
    state.polling.store(false, Ordering::SeqCst);
    state.connected.store(false, Ordering::SeqCst);
    let mut guard = state.api.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut api) = *guard {
        api.logout();
    }
    *guard = None;
    Ok("Logged out".into())
}

#[tauri::command]
pub fn vm_set_gain(state: State<VmState>, strip: u32, value: f32) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(&format!("Strip[{strip}].Gain"), value)
}

#[tauri::command]
pub fn vm_set_mute(state: State<VmState>, strip: u32, muted: bool) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(
        &format!("Strip[{strip}].Mute"),
        if muted { 1.0 } else { 0.0 },
    )
}

#[tauri::command]
pub fn vm_set_mono(state: State<VmState>, strip: u32, value: bool) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(&format!("Strip[{strip}].Mono"), if value { 1.0 } else { 0.0 })
}

#[tauri::command]
pub fn vm_set_solo(state: State<VmState>, strip: u32, value: bool) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(&format!("Strip[{strip}].Solo"), if value { 1.0 } else { 0.0 })
}

#[tauri::command]
pub fn vm_set_mc(state: State<VmState>, strip: u32, value: bool) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(&format!("Strip[{strip}].MC"), if value { 1.0 } else { 0.0 })
}

/// Karaoke mode, 0-4 (K, K-M, K-1, K-2, center-scoop) — virtual strips only.
#[tauri::command]
pub fn vm_set_karaoke(state: State<VmState>, strip: u32, value: i32) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(&format!("Strip[{strip}].K"), value as f32)
}

#[tauri::command]
pub fn vm_get_all_strips(state: State<VmState>) -> Result<AllStripsState, String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    // Call is_dirty first to sync parameters
    let _ = api.is_dirty();
    let edition = edition_or_default(&state.edition);
    let strips = monitored_strips(edition)
        .iter()
        .map(|&s| read_strip(api, edition, s))
        .collect();
    Ok(AllStripsState { strips })
}

/// Which Voicemeeter edition is running — `None` until the first successful
/// connect. Lets the frontend adapt strip counts/labels and gate
/// edition-only features (the Denoiser/Voice-Modeler FX is Potato-only)
/// instead of assuming Potato's layout everywhere.
#[tauri::command]
pub fn vm_get_edition(state: State<VmState>) -> Result<Option<VoicemeeterEdition>, String> {
    Ok(*state.edition.lock().map_err(|e| e.to_string())?)
}

/// Send level into the internal Reverb FX, 0-10 — Banana and Potato only.
#[tauri::command]
pub fn vm_set_reverb_send(state: State<VmState>, strip: u32, value: f32) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(&format!("Strip[{strip}].Reverb"), value.clamp(0.0, 10.0))
}

/// Send level into the internal Delay FX, 0-10 — Banana and Potato only.
#[tauri::command]
pub fn vm_set_delay_send(state: State<VmState>, strip: u32, value: f32) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.set_float(&format!("Strip[{strip}].Delay"), value.clamp(0.0, 10.0))
}

#[tauri::command]
pub fn vm_set_a1_device(
    state: State<VmState>,
    driver: String,
    name: String,
) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    let param = format!("Bus[0].Device.{driver}");
    api.set_string(&param, &name)?;
    // The assignment is inert until the audio engine restarts. Errors here are
    // reported rather than swallowed -- a silent failure looks exactly like a
    // switched device that never actually moved.
    api.restart_engine()
}

#[derive(Debug, Clone, Serialize)]
pub struct A1DeviceInfo {
    pub driver: String,
    pub name: String,
    pub display: String,
}

impl A1DeviceInfo {
    fn new(driver: &str, name: String) -> Self {
        Self {
            display: format!("{}: {}", driver.to_uppercase(), name),
            driver: driver.to_string(),
            name,
        }
    }
}

fn driver_type_to_string(t: i32) -> &'static str {
    match t {
        1 => "mme",
        3 => "wdm",
        4 => "ks",
        5 => "asio",
        _ => "wdm",
    }
}

#[tauri::command]
pub fn vm_get_a1_device(state: State<VmState>) -> Result<Option<A1DeviceInfo>, String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;

    let device_name = api.get_string("Bus[0].Device.name").unwrap_or_default();
    if device_name.is_empty() {
        return Ok(None);
    }

    // Match the active device against enumeration to recover its driver type
    for (dev_type, name) in api.list_output_devices() {
        if name == device_name {
            return Ok(Some(A1DeviceInfo::new(driver_type_to_string(dev_type), name)));
        }
    }

    // Device found but couldn't match via enumeration — default to WDM
    Ok(Some(A1DeviceInfo::new("wdm", device_name)))
}

#[tauri::command]
pub fn vm_restart_engine(state: State<VmState>) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.restart_engine()
}

/// Launch Voicemeeter Potato. Only ever reached from an explicit user action.
#[tauri::command]
pub fn vm_run_voicemeeter(state: State<VmState>) -> Result<(), String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    api.run_voicemeeter()
}

/// Every output device Voicemeeter can currently see, for the Outputs picker.
#[tauri::command]
pub fn vm_list_output_devices(state: State<VmState>) -> Result<Vec<A1DeviceInfo>, String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    Ok(api
        .list_output_devices()
        .into_iter()
        .map(|(dev_type, name)| A1DeviceInfo::new(driver_type_to_string(dev_type), name))
        .collect())
}

#[tauri::command]
pub fn get_accent_color() -> AccentColor {
    get_system_accent_color()
}

#[tauri::command]
pub fn set_acrylic(window_state: State<WindowState>, enabled: bool) -> Result<(), String> {
    let guard = window_state.window.lock().map_err(|e| e.to_string())?;
    let window = guard.as_ref().ok_or("No window")?;

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, clear_acrylic};
        let _ = clear_acrylic(window);
        if enabled {
            apply_acrylic(window, Some((10, 10, 10, 255))).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Set the opacity of the whole window, chrome and native backdrop included.
///
/// Tauri 2.10 exposes no opacity API, so this goes through the Win32 layered-window
/// attribute directly. CSS opacity would only fade webview content and leave the
/// acrylic backdrop fully opaque behind it, which is exactly the mismatch this is
/// meant to fix. Clamped so the window can never be made completely invisible.
#[tauri::command]
pub fn set_window_opacity(window_state: State<WindowState>, opacity: f64) -> Result<(), String> {
    let guard = window_state.window.lock().map_err(|e| e.to_string())?;
    let window = guard.as_ref().ok_or("No window")?;

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::COLORREF;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            LWA_ALPHA, WS_EX_LAYERED,
        };

        // Tauri links a newer `windows` crate than this one, so its HWND is a
        // distinct type. Bridge through the raw pointer both versions wrap.
        let raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = windows::Win32::Foundation::HWND(raw.0 as _);
        let alpha = (opacity.clamp(0.2, 1.0) * 255.0).round() as u8;

        unsafe {
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            if ex_style & (WS_EX_LAYERED.0 as isize) == 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED.0 as isize);
            }
            SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA)
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = opacity;

    Ok(())
}

#[tauri::command]
pub fn vm_sync_shortcuts(
    app: AppHandle,
    shortcut_map: State<ShortcutMap>,
    configs: Vec<MuteShortcutConfig>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let manager = app.global_shortcut();

    // Unregister all existing shortcuts
    manager.unregister_all().map_err(|e| format!("{e:?}"))?;

    let mut map = shortcut_map.map.lock().map_err(|e| e.to_string())?;
    map.clear();

    for config in configs {
        if config.hotkey.is_empty() {
            continue;
        }
        match config.hotkey.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            Ok(shortcut) => {
                let normalized = shortcut.to_string();
                match manager.register(shortcut) {
                    Ok(_) => {
                        map.insert(normalized, config.strip);
                    }
                    Err(e) => {
                        eprintln!("Failed to register shortcut '{}': {e:?}", config.hotkey);
                    }
                }
            }
            Err(e) => {
                eprintln!("Failed to parse shortcut '{}': {e:?}", config.hotkey);
            }
        }
    }

    Ok(())
}

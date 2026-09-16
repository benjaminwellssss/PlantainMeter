use crate::accent::{get_system_accent_color, AccentColor};
use crate::edition::{EditionInfo, VmEdition};
use crate::voicemeeter::{LoginStatus, VoicemeeterAPI};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
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
    /// Edition type code (1/2/3) as last reported by VBVMR_GetVoicemeeterType,
    /// or 0 while unknown. Written by whoever observes a fresh connection.
    pub edition: AtomicU8,
}

impl VmState {
    pub fn current_edition(&self) -> Option<VmEdition> {
        VmEdition::from_type_code(self.edition.load(Ordering::SeqCst) as i32)
    }

    /// The edition to lay strips out for. Banana is the historical default and
    /// keeps the old behaviour on DLLs too old to report a type.
    pub fn edition_or_default(&self) -> VmEdition {
        self.current_edition().unwrap_or(VmEdition::Banana)
    }
}

/// Ask the DLL which edition is running and remember the answer. Failure
/// ("no server" while the engine restarts, or an old DLL) keeps the previous
/// value so a transient blip never flips the layout.
fn detect_edition(api: &VoicemeeterAPI, state: &VmState) -> VmEdition {
    if let Ok(code) = api.get_voicemeeter_type() {
        if let Some(ed) = VmEdition::from_type_code(code) {
            state.edition.store(ed.type_code(), Ordering::SeqCst);
            return ed;
        }
    }
    state.edition_or_default()
}

/// Connection state reported to the frontend.
///
/// `Waiting` is a normal, recoverable state: Voicemeeter is not running yet
/// (autostart race) or the audio engine is mid-restart (device switch).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum VmConnection {
    Connected { edition: EditionInfo },
    Waiting,
}

#[derive(Debug, Clone, Serialize)]
pub struct StripState {
    pub strip: u32,
    pub gain: f32,
    pub muted: bool,
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

fn read_bus_level(api: &VoicemeeterAPI, edition: VmEdition, bus: u32) -> BusLevel {
    let (ch_l, ch_r) = edition.bus_level_channels(bus).unwrap_or((0, 1));
    let level_l = api.get_level(3, ch_l).unwrap_or(0.0);
    let level_r = api.get_level(3, ch_r).unwrap_or(0.0);
    let gain = api.get_float(&format!("Bus[{bus}].Gain")).unwrap_or(0.0);
    BusLevel { bus, level: level_l.max(level_r), gain }
}

fn read_strip_level(api: &VoicemeeterAPI, edition: VmEdition, strip: u32) -> StripLevel {
    let (ch_l, ch_r) = edition.strip_level_channels(strip).unwrap_or((0, 1));
    let level_l = api.get_level(1, ch_l).unwrap_or(0.0);
    let level_r = api.get_level(1, ch_r).unwrap_or(0.0);
    StripLevel { strip, level: level_l.max(level_r) }
}

fn read_strip(api: &VoicemeeterAPI, strip: u32) -> StripState {
    let gain = api.get_float(&format!("Strip[{strip}].Gain")).unwrap_or(0.0);
    let mute_val = api.get_float(&format!("Strip[{strip}].Mute")).unwrap_or(0.0);
    StripState {
        strip,
        gain,
        muted: mute_val >= 1.0,
    }
}

/// Current connection state as last observed by the polling thread.
fn current_connection(state: &VmState) -> VmConnection {
    if state.connected.load(Ordering::SeqCst) {
        VmConnection::Connected { edition: state.edition_or_default().info() }
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
                detect_edition(&api, &state);
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
                                // Re-detect on every recovery: the user may have
                                // quit Banana and started Potato in between.
                                let edition = if recovered {
                                    detect_edition(api, &vm_state)
                                } else {
                                    vm_state.edition_or_default()
                                };
                                if dirty || recovered {
                                    let strips: Vec<StripState> = (0..edition.strip_count())
                                        .map(|s| read_strip(api, s))
                                        .collect();
                                    let _ = app_handle
                                        .emit("vm:state-update", AllStripsState { strips });
                                }

                                // Always read levels (they change continuously)
                                let levels: Vec<StripLevel> = (0..edition.strip_count())
                                    .map(|s| read_strip_level(api, edition, s))
                                    .collect();
                                let _ = app_handle.emit("vm:levels", AllStripLevels { levels });

                                // Output bus levels for every bus of this edition
                                let bus_levels: Vec<BusLevel> = (0..edition.bus_count())
                                    .map(|b| read_bus_level(api, edition, b))
                                    .collect();
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
                    VmConnection::Connected { edition: vm_state.edition_or_default().info() }
                } else {
                    VmConnection::Waiting
                };
                let _ = app_handle.emit("vm:connection", payload);
                // FxState is taken here with the api lock already released.
                if healthy {
                    crate::fx::announce(&app_handle);
                } else {
                    crate::fx::on_connection_lost(&app_handle);
                }
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
pub fn vm_get_all_strips(state: State<VmState>) -> Result<AllStripsState, String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    // Call is_dirty first to sync parameters
    let _ = api.is_dirty();
    let edition = match state.current_edition() {
        Some(ed) => ed,
        None => detect_edition(api, &state),
    };
    let strips = (0..edition.strip_count())
        .map(|s| read_strip(api, s))
        .collect();
    Ok(AllStripsState { strips })
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

/// Launch Voicemeeter. Only ever reached from an explicit user action.
///
/// `edition` is the user's launch preference; `None` means auto: the edition
/// last seen running, else the newest edition that is installed.
#[tauri::command]
pub fn vm_run_voicemeeter(
    state: State<VmState>,
    edition: Option<VmEdition>,
) -> Result<VmEdition, String> {
    let guard = state.api.lock().map_err(|e| e.to_string())?;
    let api = guard.as_ref().ok_or("Not connected")?;
    let chosen = edition
        .or_else(|| state.current_edition())
        .or_else(|| VmEdition::installed_editions().into_iter().next())
        .ok_or("No Voicemeeter edition found in the install folder")?;
    api.run_voicemeeter(chosen.run_type_code())?;
    Ok(chosen)
}

/// Editions present in the install folder, newest first.
#[tauri::command]
pub fn vm_list_installed_editions() -> Vec<VmEdition> {
    VmEdition::installed_editions()
}

/// The edition currently (or most recently) detected, if any.
#[tauri::command]
pub fn vm_get_edition(state: State<VmState>) -> Option<EditionInfo> {
    state.current_edition().map(|e| e.info())
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


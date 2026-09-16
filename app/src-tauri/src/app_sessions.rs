//! Per-application volume for apps playing into Voicemeeter's virtual inputs.
//!
//! Voicemeeter's Remote API can *set* per-app gain and mute but cannot list
//! apps or read their levels, so this goes straight to Windows Core Audio:
//! enumerate the render endpoints whose friendly name marks them as Voicemeeter
//! inputs, then walk each endpoint's audio sessions (one per app) for
//! volume, mute and a peak meter. Setting volume through `ISimpleAudioVolume`
//! is exactly what Voicemeeter's own per-app panel does under the hood.
//!
//! All COM work happens on one dedicated worker thread that owns the
//! interfaces (they are not `Send`); commands arrive over a channel and reply
//! over a one-shot channel. While polling is enabled the worker pushes
//! `vm:app-levels` every ~66 ms and re-enumerates sessions about once a second,
//! emitting `vm:app-sessions`.

use crate::commands::VmState;
use crate::edition::{VirtualInput, VmEdition};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub const SESSIONS_EVENT: &str = "vm:app-sessions";
pub const LEVELS_EVENT: &str = "vm:app-levels";

const LEVEL_TICK: Duration = Duration::from_millis(66);
/// Full re-enumeration every N level ticks (~1 s).
const REFRESH_EVERY: u32 = 15;
const REPLY_TIMEOUT: Duration = Duration::from_millis(1500);

// ---------------------------------------------------------------- payloads

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EndpointKind {
    Vaio,
    Aux,
    Vaio3,
    /// Potato's "Voicemeeter In N" endpoints feed hardware strip N (1-based).
    Hw(u32),
}

impl EndpointKind {
    fn strip(self, edition: VmEdition) -> Option<u32> {
        match self {
            EndpointKind::Vaio => edition.virtual_endpoint_strip(VirtualInput::Vaio),
            EndpointKind::Aux => edition.virtual_endpoint_strip(VirtualInput::Aux),
            EndpointKind::Vaio3 => edition.virtual_endpoint_strip(VirtualInput::Vaio3),
            EndpointKind::Hw(n) => edition.hw_endpoint_strip(n),
        }
    }

    /// Display order: virtual inputs first, then hardware feeds by number.
    fn order(self) -> u32 {
        match self {
            EndpointKind::Vaio => 0,
            EndpointKind::Aux => 1,
            EndpointKind::Vaio3 => 2,
            EndpointKind::Hw(n) => 10 + n,
        }
    }

    fn tag(self) -> &'static str {
        match self {
            EndpointKind::Vaio => "vaio",
            EndpointKind::Aux => "aux",
            EndpointKind::Vaio3 => "vaio3",
            EndpointKind::Hw(_) => "hw",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSession {
    pub key: String,
    pub pid: u32,
    pub process: String,
    pub display: String,
    /// PNG data URL of the executable's icon, when one could be extracted.
    pub icon: Option<String>,
    /// Windows' own "System sounds" session (one per endpoint).
    pub system: bool,
    pub volume: f32,
    pub muted: bool,
    pub state: &'static str,
    pub peak: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEndpoint {
    pub endpoint: String,
    pub kind: &'static str,
    pub strip: Option<u32>,
    pub sessions: Vec<AppSession>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSessionsPayload {
    pub endpoints: Vec<AppEndpoint>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLevel {
    pub key: String,
    pub peak: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLevelsPayload {
    pub levels: Vec<AppLevel>,
}

// ---------------------------------------------------------------- pure helpers

/// Recognise a Voicemeeter playback endpoint from its Windows friendly name,
/// e.g. "Voicemeeter AUX Input (VB-Audio Voicemeeter VAIO)".
pub fn classify_endpoint(friendly_name: &str) -> Option<EndpointKind> {
    let n = friendly_name.trim().to_ascii_lowercase();
    if n.starts_with("voicemeeter aux input") {
        Some(EndpointKind::Aux)
    } else if n.starts_with("voicemeeter vaio3 input") {
        Some(EndpointKind::Vaio3)
    } else if n.starts_with("voicemeeter input") {
        Some(EndpointKind::Vaio)
    } else if let Some(rest) = n.strip_prefix("voicemeeter in ") {
        rest.split(|c: char| !c.is_ascii_digit())
            .next()
            .and_then(|d| d.parse::<u32>().ok())
            .map(EndpointKind::Hw)
    } else {
        None
    }
}

/// Pick the name shown for a session. Windows display names are often empty
/// or an "@dll,-123" resource reference, in which case the exe name wins.
pub fn display_name(raw: &str, process: &str, system_sounds: bool) -> String {
    if system_sounds {
        return "System sounds".to_string();
    }
    let raw = raw.trim();
    if !raw.is_empty() && !raw.starts_with('@') {
        return raw.to_string();
    }
    if !process.is_empty() {
        return process.to_string();
    }
    "Unknown app".to_string()
}

/// "C:\Apps\Spotify\Spotify.exe" -> "Spotify".
pub fn exe_stem(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    match file.rfind('.') {
        Some(i) if file[i..].eq_ignore_ascii_case(".exe") => file[..i].to_string(),
        _ => file.to_string(),
    }
}

// ---------------------------------------------------------------- worker plumbing

enum SessionCmd {
    List(Sender<Result<AppSessionsPayload, String>>),
    SetVolume {
        key: String,
        volume: f32,
        reply: Sender<Result<(), String>>,
    },
    SetMute {
        key: String,
        muted: bool,
        reply: Sender<Result<(), String>>,
    },
    SetPolling(bool),
}

#[derive(Default)]
pub struct AppSessionsHandle {
    tx: Mutex<Option<Sender<SessionCmd>>>,
}

impl AppSessionsHandle {
    fn sender(&self, app: &AppHandle) -> Result<Sender<SessionCmd>, String> {
        let mut guard = self.tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = guard.as_ref() {
            return Ok(tx.clone());
        }
        let (tx, rx) = mpsc::channel::<SessionCmd>();
        let app = app.clone();
        thread::Builder::new()
            .name("app-sessions".into())
            .spawn(move || worker::run(app, rx))
            .map_err(|e| e.to_string())?;
        *guard = Some(tx.clone());
        Ok(tx)
    }
}

fn request<T>(
    app: &AppHandle,
    handle: &AppSessionsHandle,
    build: impl FnOnce(Sender<Result<T, String>>) -> SessionCmd,
) -> Result<T, String> {
    let tx = handle.sender(app)?;
    let (reply_tx, reply_rx) = mpsc::channel();
    tx.send(build(reply_tx)).map_err(|_| "Audio session worker is gone")?;
    reply_rx
        .recv_timeout(REPLY_TIMEOUT)
        .map_err(|_| "Audio session worker did not answer in time".to_string())?
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn vm_list_app_sessions(
    app: AppHandle,
    handle: State<AppSessionsHandle>,
) -> Result<AppSessionsPayload, String> {
    request(&app, &handle, SessionCmd::List)
}

#[tauri::command]
pub fn vm_set_app_volume(
    app: AppHandle,
    handle: State<AppSessionsHandle>,
    key: String,
    volume: f32,
) -> Result<(), String> {
    let volume = volume.clamp(0.0, 1.0);
    request(&app, &handle, |reply| SessionCmd::SetVolume { key, volume, reply })
}

#[tauri::command]
pub fn vm_set_app_mute(
    app: AppHandle,
    handle: State<AppSessionsHandle>,
    key: String,
    muted: bool,
) -> Result<(), String> {
    request(&app, &handle, |reply| SessionCmd::SetMute { key, muted, reply })
}

#[tauri::command]
pub fn vm_set_app_polling(
    app: AppHandle,
    handle: State<AppSessionsHandle>,
    enabled: bool,
) -> Result<(), String> {
    let tx = handle.sender(&app)?;
    tx.send(SessionCmd::SetPolling(enabled))
        .map_err(|_| "Audio session worker is gone".to_string())
}

// ---------------------------------------------------------------- COM worker (Windows only)

#[cfg(target_os = "windows")]
mod worker {
    use super::*;
    use windows::core::{Interface, PCWSTR, PWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBRUSH, HDC,
    };
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON};
    use base64::Engine;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{
        eRender, AudioSessionStateActive, AudioSessionStateExpired, IAudioSessionControl2,
        IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    struct SessionCtx {
        volume: ISimpleAudioVolume,
        meter: IAudioMeterInformation,
    }

    #[derive(Clone, Default)]
    struct ProcInfo {
        name: String,
        icon: Option<String>,
    }

    struct Worker {
        app: AppHandle,
        enumerator: IMMDeviceEnumerator,
        /// Live session interfaces from the last enumeration, by session key.
        sessions: HashMap<String, SessionCtx>,
        /// pid -> exe stem + icon, so we don't open a process handle 15 times a second.
        processes: HashMap<u32, ProcInfo>,
        /// exe path -> icon, kept across app restarts (icon extraction is slow-ish).
        icons: HashMap<String, Option<String>>,
    }

    /// Take ownership of a COM-allocated string and free it.
    unsafe fn take_pwstr(p: PWSTR) -> String {
        if p.is_null() {
            return String::new();
        }
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }

    /// Full image path of a process, or "" when it cannot be opened.
    fn process_path(pid: u32) -> String {
        if pid == 0 {
            return String::new();
        }
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return String::new();
            };
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .is_ok();
            let _ = CloseHandle(handle);
            if !ok {
                return String::new();
            }
            String::from_utf16_lossy(&buf[..len as usize])
        }
    }

    const ICON_PX: i32 = 32;

    /// The executable's icon as a PNG data URL. Shell icon lookup plus a GDI
    /// draw into a 32-bit top-down DIB, so alpha comes out intact.
    fn exe_icon_data_url(path: &str) -> Option<String> {
        if path.is_empty() {
            return None;
        }
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let mut info = SHFILEINFOW::default();
            let rc = SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            );
            if rc == 0 || info.hIcon.is_invalid() {
                return None;
            }
            let png = icon_to_png(info.hIcon);
            let _ = DestroyIcon(info.hIcon);
            png.map(|bytes| {
                format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )
            })
        }
    }

    unsafe fn icon_to_png(icon: HICON) -> Option<Vec<u8>> {
        let hdc = CreateCompatibleDC(HDC::default());
        if hdc.is_invalid() {
            return None;
        }
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: ICON_PX,
            biHeight: -ICON_PX, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let hbm = match CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut bits, HANDLE::default(), 0) {
            Ok(h) => h,
            Err(_) => {
                let _ = DeleteDC(hdc);
                return None;
            }
        };
        let old = SelectObject(hdc, hbm);
        let drew = DrawIconEx(hdc, 0, 0, icon, ICON_PX, ICON_PX, 0, HBRUSH::default(), DI_NORMAL).is_ok();
        let mut rgba: Vec<u8> = Vec::new();
        if drew && !bits.is_null() {
            let n = (ICON_PX * ICON_PX * 4) as usize;
            let src = std::slice::from_raw_parts(bits as *const u8, n);
            rgba = src.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
        }
        SelectObject(hdc, old);
        let _ = DeleteObject(hbm);
        let _ = DeleteDC(hdc);
        if rgba.is_empty() {
            return None;
        }
        // Legacy icons without an alpha channel leave alpha at 0 everywhere.
        if rgba.iter().skip(3).step_by(4).all(|&a| a == 0) {
            for px in rgba.chunks_exact_mut(4) {
                px[3] = 255;
            }
        }
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, ICON_PX as u32, ICON_PX as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().ok()?;
            writer.write_image_data(&rgba).ok()?;
        }
        Some(out)
    }

    impl Worker {
        fn new(app: AppHandle) -> Result<Self, String> {
            let enumerator: IMMDeviceEnumerator = unsafe {
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("MMDeviceEnumerator: {e}"))?
            };
            Ok(Self {
                app,
                enumerator,
                sessions: HashMap::new(),
                processes: HashMap::new(),
                icons: HashMap::new(),
            })
        }

        fn edition(&self) -> VmEdition {
            let vm: State<VmState> = self.app.state();
            vm.edition_or_default()
        }

        /// Walk every Voicemeeter render endpoint and its sessions, refreshing
        /// the interface cache as a side effect.
        fn refresh(&mut self) -> Result<AppSessionsPayload, String> {
            let edition = self.edition();
            let mut endpoints: Vec<(EndpointKind, AppEndpoint)> = Vec::new();
            let mut sessions: HashMap<String, SessionCtx> = HashMap::new();

            unsafe {
                let collection = self
                    .enumerator
                    .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                    .map_err(|e| format!("EnumAudioEndpoints: {e}"))?;
                let count = collection.GetCount().map_err(|e| e.to_string())?;

                for i in 0..count {
                    let Ok(device) = collection.Item(i) else { continue };
                    let Ok(store) = device.OpenPropertyStore(STGM_READ) else { continue };
                    let name = match store.GetValue(&PKEY_Device_FriendlyName) {
                        Ok(v) => v.to_string(),
                        Err(_) => continue,
                    };
                    let Some(kind) = classify_endpoint(&name) else { continue };

                    let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                        continue;
                    };
                    let Ok(list) = manager.GetSessionEnumerator() else { continue };
                    let n = list.GetCount().unwrap_or(0);

                    let mut apps: Vec<AppSession> = Vec::new();
                    for j in 0..n {
                        let Ok(control) = list.GetSession(j) else { continue };
                        let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                        let state = control2.GetState().unwrap_or(AudioSessionStateExpired);
                        if state == AudioSessionStateExpired {
                            continue;
                        }
                        let key = take_pwstr(control2.GetSessionInstanceIdentifier().unwrap_or(PWSTR::null()));
                        if key.is_empty() {
                            continue;
                        }
                        let pid = control2.GetProcessId().unwrap_or(0);
                        let system = control2.IsSystemSoundsSession() == S_OK;
                        let raw_name = take_pwstr(control2.GetDisplayName().unwrap_or(PWSTR::null()));
                        let proc_info = match self.processes.get(&pid) {
                            Some(p) => p.clone(),
                            None => {
                                let path = process_path(pid);
                                let icon = if path.is_empty() {
                                    None
                                } else {
                                    self.icons
                                        .entry(path.clone())
                                        .or_insert_with(|| exe_icon_data_url(&path))
                                        .clone()
                                };
                                let info = ProcInfo { name: exe_stem(&path), icon };
                                self.processes.insert(pid, info.clone());
                                info
                            }
                        };
                        let process = proc_info.name;

                        let Ok(volume) = control.cast::<ISimpleAudioVolume>() else { continue };
                        let Ok(meter) = control.cast::<IAudioMeterInformation>() else { continue };

                        apps.push(AppSession {
                            key: key.clone(),
                            pid,
                            display: display_name(&raw_name, &process, system),
                            process,
                            icon: if system { None } else { proc_info.icon },
                            system,
                            volume: volume.GetMasterVolume().unwrap_or(0.0),
                            muted: volume.GetMute().map(|b| b.as_bool()).unwrap_or(false),
                            state: if state == AudioSessionStateActive { "active" } else { "inactive" },
                            peak: meter.GetPeakValue().unwrap_or(0.0),
                        });
                        sessions.insert(key, SessionCtx { volume, meter });
                    }

                    // Real apps first (alphabetical), Windows' system-sounds session last.
                    apps.sort_by(|a, b| {
                        (a.system, a.display.to_lowercase()).cmp(&(b.system, b.display.to_lowercase()))
                    });
                    endpoints.push((
                        kind,
                        AppEndpoint {
                            endpoint: name,
                            kind: kind.tag(),
                            strip: kind.strip(edition),
                            sessions: apps,
                        },
                    ));
                }
            }

            endpoints.sort_by_key(|(kind, _)| kind.order());
            self.sessions = sessions;
            // Forget names of processes that no longer have a session.
            let live: std::collections::HashSet<u32> = endpoints
                .iter()
                .flat_map(|(_, e)| e.sessions.iter().map(|s| s.pid))
                .collect();
            self.processes.retain(|pid, _| live.contains(pid));

            Ok(AppSessionsPayload {
                endpoints: endpoints.into_iter().map(|(_, e)| e).collect(),
            })
        }

        fn levels(&self) -> AppLevelsPayload {
            let levels = self
                .sessions
                .iter()
                .map(|(key, ctx)| AppLevel {
                    key: key.clone(),
                    peak: unsafe { ctx.meter.GetPeakValue().unwrap_or(0.0) },
                })
                .collect();
            AppLevelsPayload { levels }
        }

        fn set_volume(&self, key: &str, volume: f32) -> Result<(), String> {
            let ctx = self.sessions.get(key).ok_or("session gone")?;
            unsafe { ctx.volume.SetMasterVolume(volume, std::ptr::null()) }
                .map_err(|e| e.to_string())
        }

        fn set_mute(&self, key: &str, muted: bool) -> Result<(), String> {
            let ctx = self.sessions.get(key).ok_or("session gone")?;
            unsafe { ctx.volume.SetMute(muted, std::ptr::null()) }.map_err(|e| e.to_string())
        }
    }

    pub fn run(app: AppHandle, rx: mpsc::Receiver<SessionCmd>) {
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_err() {
            let err = format!("CoInitializeEx failed: {hr}");
            drain_with_error(rx, &err);
            return;
        }

        let mut worker = match Worker::new(app) {
            Ok(w) => w,
            Err(e) => {
                drain_with_error(rx, &e);
                unsafe { CoUninitialize() };
                return;
            }
        };

        let mut polling = false;
        let mut tick: u32 = 0;
        loop {
            let wait = if polling { LEVEL_TICK } else { Duration::from_secs(3600) };
            match rx.recv_timeout(wait) {
                Ok(SessionCmd::List(reply)) => {
                    let _ = reply.send(worker.refresh());
                }
                Ok(SessionCmd::SetVolume { key, volume, reply }) => {
                    let _ = reply.send(worker.set_volume(&key, volume));
                }
                Ok(SessionCmd::SetMute { key, muted, reply }) => {
                    let _ = reply.send(worker.set_mute(&key, muted));
                }
                Ok(SessionCmd::SetPolling(enabled)) => {
                    polling = enabled;
                    tick = 0;
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !polling {
                        continue;
                    }
                    tick = tick.wrapping_add(1);
                    if tick % REFRESH_EVERY == 0 {
                        match worker.refresh() {
                            Ok(payload) => {
                                let _ = worker.app.emit(SESSIONS_EVENT, payload);
                            }
                            Err(e) => eprintln!("app sessions refresh failed: {e}"),
                        }
                    }
                    let _ = worker.app.emit(LEVELS_EVENT, worker.levels());
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }

        drop(worker);
        unsafe { CoUninitialize() };
    }

    fn drain_with_error(rx: mpsc::Receiver<SessionCmd>, err: &str) {
        for cmd in rx {
            match cmd {
                SessionCmd::List(reply) => {
                    let _ = reply.send(Err(err.to_string()));
                }
                SessionCmd::SetVolume { reply, .. } | SessionCmd::SetMute { reply, .. } => {
                    let _ = reply.send(Err(err.to_string()));
                }
                SessionCmd::SetPolling(_) => {}
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod worker {
    use super::*;
    pub fn run(_app: AppHandle, rx: mpsc::Receiver<SessionCmd>) {
        for cmd in rx {
            match cmd {
                SessionCmd::List(reply) => {
                    let _ = reply.send(Err("Per-app audio is Windows only".into()));
                }
                SessionCmd::SetVolume { reply, .. } | SessionCmd::SetMute { reply, .. } => {
                    let _ = reply.send(Err("Per-app audio is Windows only".into()));
                }
                SessionCmd::SetPolling(_) => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_voicemeeter_endpoints() {
        assert_eq!(
            classify_endpoint("Voicemeeter Input (VB-Audio Voicemeeter VAIO)"),
            Some(EndpointKind::Vaio)
        );
        assert_eq!(
            classify_endpoint("Voicemeeter AUX Input (VB-Audio Voicemeeter VAIO)"),
            Some(EndpointKind::Aux)
        );
        assert_eq!(
            classify_endpoint("Voicemeeter VAIO3 Input (VB-Audio Voicemeeter VAIO)"),
            Some(EndpointKind::Vaio3)
        );
        assert_eq!(
            classify_endpoint("Voicemeeter In 4 (VB-Audio Voicemeeter VAIO)"),
            Some(EndpointKind::Hw(4))
        );
        // Outputs and unrelated devices are ignored.
        assert_eq!(classify_endpoint("Voicemeeter Out A1 (VB-Audio Voicemeeter VAIO)"), None);
        assert_eq!(classify_endpoint("CABLE Input (VB-Audio Virtual Cable)"), None);
        assert_eq!(classify_endpoint("Speakers (Focusrite USB Audio)"), None);
    }

    #[test]
    fn endpoint_strip_follows_edition() {
        assert_eq!(EndpointKind::Vaio.strip(VmEdition::Potato), Some(5));
        assert_eq!(EndpointKind::Aux.strip(VmEdition::Banana), Some(4));
        assert_eq!(EndpointKind::Vaio3.strip(VmEdition::Banana), None);
        assert_eq!(EndpointKind::Hw(1).strip(VmEdition::Potato), Some(0));
        assert_eq!(EndpointKind::Hw(1).strip(VmEdition::Banana), None);
    }

    #[test]
    fn display_name_prefers_real_names() {
        assert_eq!(display_name("Spotify Premium", "Spotify", false), "Spotify Premium");
        assert_eq!(display_name("", "Spotify", false), "Spotify");
        assert_eq!(display_name("@%SystemRoot%\\System32\\AudioSrv.Dll,-202", "svchost", false), "svchost");
        assert_eq!(display_name("", "", false), "Unknown app");
        assert_eq!(display_name("whatever", "x", true), "System sounds");
    }

    #[test]
    fn exe_stem_strips_path_and_extension() {
        assert_eq!(exe_stem(r"C:\Users\me\AppData\Roaming\Spotify\Spotify.exe"), "Spotify");
        assert_eq!(exe_stem("C:/Program Files/Plexamp/Plexamp.EXE"), "Plexamp");
        assert_eq!(exe_stem("firefox"), "firefox");
        assert_eq!(exe_stem(r"D:\tools\node.exe.bak"), "node.exe.bak");
    }
}

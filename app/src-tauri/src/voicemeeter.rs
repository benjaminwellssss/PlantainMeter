use libloading::{Library, Symbol};
use std::ffi::CString;
use std::os::raw::{c_char, c_float, c_long};
use std::path::Path;

type FnLogin = unsafe extern "C" fn() -> c_long;
type FnLogout = unsafe extern "C" fn() -> c_long;
type FnSetFloat = unsafe extern "C" fn(*const c_char, c_float) -> c_long;
type FnGetFloat = unsafe extern "C" fn(*const c_char, *mut c_float) -> c_long;
type FnSetString = unsafe extern "C" fn(*const c_char, *const c_char) -> c_long;
type FnGetString = unsafe extern "C" fn(*const c_char, *mut c_char) -> c_long;
type FnIsDirty = unsafe extern "C" fn() -> c_long;
type FnGetLevel = unsafe extern "C" fn(c_long, c_long, *mut c_float) -> c_long;
type FnOutputGetDeviceNumber = unsafe extern "C" fn() -> c_long;
type FnOutputGetDeviceDesc = unsafe extern "C" fn(c_long, *mut c_long, *mut c_char, *mut c_char) -> c_long;
type FnRunVoicemeeter = unsafe extern "C" fn(c_long) -> c_long;
type FnGetVoicemeeterType = unsafe extern "C" fn(*mut c_long) -> c_long;

/// Outcome of VBVMR_Login. The DLL distinguishes "connected" from
/// "logged in, but the Voicemeeter application isn't running" (rc == 1),
/// and the difference decides whether we have a usable audio engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginStatus {
    /// rc == 0 — Voicemeeter is running and the engine is reachable.
    Connected,
    /// rc == 1 — login succeeded but the Voicemeeter application is not launched.
    NotRunning,
}

pub struct VoicemeeterAPI {
    _lib: Library,
    fn_login: FnLogin,
    fn_logout: FnLogout,
    fn_set_float: FnSetFloat,
    fn_get_float: FnGetFloat,
    fn_set_string: FnSetString,
    fn_get_string: FnGetString,
    fn_is_dirty: FnIsDirty,
    fn_get_level: FnGetLevel,
    fn_output_get_device_number: Option<FnOutputGetDeviceNumber>,
    fn_output_get_device_desc: Option<FnOutputGetDeviceDesc>,
    fn_run_voicemeeter: Option<FnRunVoicemeeter>,
    fn_get_voicemeeter_type: Option<FnGetVoicemeeterType>,
    logged_in: bool,
}

// SAFETY: VoicemeeterAPI wraps a DLL that uses thread-safe COM calls.
// All access is guarded by a Mutex in the Tauri state.
unsafe impl Send for VoicemeeterAPI {}

impl VoicemeeterAPI {
    pub fn new() -> Result<Self, String> {
        let base = Path::new(r"C:\Program Files (x86)\VB\Voicemeeter");
        let dll_name = if std::mem::size_of::<usize>() == 8 {
            "VoicemeeterRemote64.dll"
        } else {
            "VoicemeeterRemote.dll"
        };
        let dll_path = base.join(dll_name);

        if !dll_path.exists() {
            return Err(format!("Voicemeeter DLL not found: {}", dll_path.display()));
        }

        unsafe {
            let lib = Library::new(&dll_path)
                .map_err(|e| format!("Failed to load DLL: {e}"))?;

            let fn_login: Symbol<FnLogin> = lib.get(b"VBVMR_Login")
                .map_err(|e| format!("Missing VBVMR_Login: {e}"))?;
            let fn_logout: Symbol<FnLogout> = lib.get(b"VBVMR_Logout")
                .map_err(|e| format!("Missing VBVMR_Logout: {e}"))?;
            let fn_set_float: Symbol<FnSetFloat> = lib.get(b"VBVMR_SetParameterFloat")
                .map_err(|e| format!("Missing VBVMR_SetParameterFloat: {e}"))?;
            let fn_get_float: Symbol<FnGetFloat> = lib.get(b"VBVMR_GetParameterFloat")
                .map_err(|e| format!("Missing VBVMR_GetParameterFloat: {e}"))?;
            let fn_set_string: Symbol<FnSetString> = lib.get(b"VBVMR_SetParameterStringA")
                .map_err(|e| format!("Missing VBVMR_SetParameterStringA: {e}"))?;
            let fn_get_string: Symbol<FnGetString> = lib.get(b"VBVMR_GetParameterStringA")
                .map_err(|e| format!("Missing VBVMR_GetParameterStringA: {e}"))?;
            let fn_is_dirty: Symbol<FnIsDirty> = lib.get(b"VBVMR_IsParametersDirty")
                .map_err(|e| format!("Missing VBVMR_IsParametersDirty: {e}"))?;
            let fn_get_level: Symbol<FnGetLevel> = lib.get(b"VBVMR_GetLevel")
                .map_err(|e| format!("Missing VBVMR_GetLevel: {e}"))?;

            // Optional device enumeration functions (may not exist in older DLLs)
            let fn_output_get_device_number: Option<FnOutputGetDeviceNumber> =
                lib.get::<FnOutputGetDeviceNumber>(b"VBVMR_Output_GetDeviceNumber").ok().map(|s| *s);
            let fn_output_get_device_desc: Option<FnOutputGetDeviceDesc> =
                lib.get::<FnOutputGetDeviceDesc>(b"VBVMR_Output_GetDeviceDescA").ok().map(|s| *s);
            let fn_run_voicemeeter: Option<FnRunVoicemeeter> =
                lib.get::<FnRunVoicemeeter>(b"VBVMR_RunVoicemeeter").ok().map(|s| *s);
            let fn_get_voicemeeter_type: Option<FnGetVoicemeeterType> =
                lib.get::<FnGetVoicemeeterType>(b"VBVMR_GetVoicemeeterType").ok().map(|s| *s);

            Ok(Self {
                fn_login: *fn_login,
                fn_logout: *fn_logout,
                fn_set_float: *fn_set_float,
                fn_get_float: *fn_get_float,
                fn_set_string: *fn_set_string,
                fn_get_string: *fn_get_string,
                fn_is_dirty: *fn_is_dirty,
                fn_get_level: *fn_get_level,
                fn_output_get_device_number,
                fn_output_get_device_desc,
                fn_run_voicemeeter,
                fn_get_voicemeeter_type,
                _lib: lib,
                logged_in: false,
            })
        }
    }

    /// Log in to the Voicemeeter Remote API.
    ///
    /// Per the SDK: 0 = OK, 1 = OK but the Voicemeeter application is not launched,
    /// -1 = cannot get client, -2 = unexpected login. rc == 1 is a *successful* login
    /// against a missing application, so we keep the handle and report NotRunning
    /// rather than treating it as connected.
    pub fn login(&mut self) -> Result<LoginStatus, String> {
        let rc = unsafe { (self.fn_login)() };
        match rc {
            0 => {
                self.logged_in = true;
                Ok(LoginStatus::Connected)
            }
            1 => {
                self.logged_in = true;
                Ok(LoginStatus::NotRunning)
            }
            _ => Err(format!(
                "VBVMR_Login failed with code {rc}. Is Voicemeeter installed correctly?"
            )),
        }
    }

    /// Request an audio-engine restart.
    ///
    /// `Command.Restart` is a FLOAT parameter — setting a string parameter named
    /// "Command" is not valid and silently fails. Bus device assignments only take
    /// effect once the engine restarts, so this is what actually moves the audio.
    pub fn restart_engine(&self) -> Result<(), String> {
        self.set_float("Command.Restart", 1.0)
    }

    /// Launch a Voicemeeter edition via the DLL. `type_code` follows
    /// VBVMR_RunVoicemeeter: 1/2/3 = 32-bit Standard/Banana/Potato, 4/5/6 = x64.
    /// Returns an error if the DLL is too old to export VBVMR_RunVoicemeeter.
    pub fn run_voicemeeter(&self, type_code: c_long) -> Result<(), String> {
        let f = self
            .fn_run_voicemeeter
            .ok_or("This Voicemeeter DLL cannot launch the application (VBVMR_RunVoicemeeter missing)")?;
        let rc = unsafe { f(type_code) };
        if rc == 0 {
            Ok(())
        } else {
            Err(format!("VBVMR_RunVoicemeeter failed: {rc}"))
        }
    }

    /// Which edition is running: 1 = Standard, 2 = Banana, 3 = Potato.
    /// Fails with "no server" (-2) while Voicemeeter is not running, so callers
    /// should retry on the next healthy tick rather than cache a failure.
    pub fn get_voicemeeter_type(&self) -> Result<i32, String> {
        self.require_login()?;
        let f = self
            .fn_get_voicemeeter_type
            .ok_or("VBVMR_GetVoicemeeterType missing from this Voicemeeter DLL")?;
        let mut vm_type: c_long = 0;
        let rc = unsafe { f(&mut vm_type) };
        if rc == 0 {
            Ok(vm_type as i32)
        } else {
            Err(format!("VBVMR_GetVoicemeeterType failed: {rc}"))
        }
    }

    pub fn logout(&mut self) {
        if self.logged_in {
            unsafe { (self.fn_logout)() };
            self.logged_in = false;
        }
    }

    pub fn is_dirty(&self) -> Result<bool, String> {
        self.require_login()?;
        let rc = unsafe { (self.fn_is_dirty)() };
        if rc < 0 {
            Err(format!("VBVMR_IsParametersDirty error: {rc}"))
        } else {
            Ok(rc == 1)
        }
    }

    pub fn set_float(&self, param: &str, value: f32) -> Result<(), String> {
        self.require_login()?;
        let param_c = CString::new(param).map_err(|e| e.to_string())?;
        let rc = unsafe { (self.fn_set_float)(param_c.as_ptr(), value) };
        if rc == 0 {
            Ok(())
        } else {
            Err(format!("SetParameterFloat({param}, {value}) failed: {rc}"))
        }
    }

    pub fn get_float(&self, param: &str) -> Result<f32, String> {
        self.require_login()?;
        let param_c = CString::new(param).map_err(|e| e.to_string())?;
        let mut value: c_float = 0.0;
        let rc = unsafe { (self.fn_get_float)(param_c.as_ptr(), &mut value) };
        if rc == 0 {
            Ok(value)
        } else {
            Err(format!("GetParameterFloat({param}) failed: {rc}"))
        }
    }

    pub fn set_string(&self, param: &str, value: &str) -> Result<(), String> {
        self.require_login()?;
        let param_c = CString::new(param).map_err(|e| e.to_string())?;
        let value_c = CString::new(value).map_err(|e| e.to_string())?;
        let rc = unsafe { (self.fn_set_string)(param_c.as_ptr(), value_c.as_ptr()) };
        if rc == 0 {
            Ok(())
        } else {
            Err(format!("SetParameterStringA({param}, {value}) failed: {rc}"))
        }
    }

    pub fn get_string(&self, param: &str) -> Result<String, String> {
        self.require_login()?;
        let param_c = CString::new(param).map_err(|e| e.to_string())?;
        let mut buf = [0u8; 512];
        let rc = unsafe {
            (self.fn_get_string)(param_c.as_ptr(), buf.as_mut_ptr() as *mut c_char)
        };
        if rc == 0 {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            String::from_utf8(buf[..end].to_vec()).map_err(|e| e.to_string())
        } else {
            Err(format!("GetParameterStringA({param}) failed: {rc}"))
        }
    }

    /// Read audio level from Voicemeeter.
    /// n_type: 0=pre-fader, 1=post-fader, 2=post-mute input, 3=output
    /// n_channel: channel index (strips have L/R pairs)
    pub fn get_level(&self, n_type: i32, n_channel: i32) -> Result<f32, String> {
        self.require_login()?;
        let mut value: c_float = 0.0;
        let rc = unsafe {
            (self.fn_get_level)(n_type as c_long, n_channel as c_long, &mut value)
        };
        if rc == 0 {
            Ok(value)
        } else {
            // -1 or -2 means no data available yet — return silence
            Ok(0.0)
        }
    }

    /// Returns the number of available output devices, or 0 if unsupported.
    pub fn output_device_count(&self) -> i32 {
        match self.fn_output_get_device_number {
            Some(f) => unsafe { f() as i32 },
            None => 0,
        }
    }

    /// Returns (driver_type, device_name) for the given output device index.
    /// driver_type: 1=MME, 3=WDM, 4=KS, 5=ASIO
    pub fn output_device_desc(&self, index: i32) -> Result<(i32, String), String> {
        let f = self.fn_output_get_device_desc
            .ok_or("Device enumeration not available")?;
        let mut dev_type: c_long = 0;
        let mut name_buf = [0u8; 512];
        let mut hwid_buf = [0u8; 512];
        let rc = unsafe {
            f(
                index as c_long,
                &mut dev_type,
                name_buf.as_mut_ptr() as *mut c_char,
                hwid_buf.as_mut_ptr() as *mut c_char,
            )
        };
        if rc == 0 {
            let end = name_buf.iter().position(|&b| b == 0).unwrap_or(name_buf.len());
            let name = String::from_utf8(name_buf[..end].to_vec()).map_err(|e| e.to_string())?;
            Ok((dev_type as i32, name))
        } else {
            Err(format!("Output_GetDeviceDescA({index}) failed: {rc}"))
        }
    }

    /// Enumerate every output device Voicemeeter can see as (driver_type, name).
    /// Devices that fail to describe are skipped rather than aborting the sweep.
    pub fn list_output_devices(&self) -> Vec<(i32, String)> {
        let count = self.output_device_count();
        let mut devices = Vec::new();
        for i in 0..count {
            if let Ok((dev_type, name)) = self.output_device_desc(i) {
                if !name.is_empty() {
                    devices.push((dev_type, name));
                }
            }
        }
        devices
    }

    fn require_login(&self) -> Result<(), String> {
        if self.logged_in {
            Ok(())
        } else {
            Err("Not logged in to Voicemeeter".into())
        }
    }
}

impl Drop for VoicemeeterAPI {
    fn drop(&mut self) {
        self.logout();
    }
}

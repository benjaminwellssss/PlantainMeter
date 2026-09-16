//! Voicemeeter edition detection and per-edition layout tables.
//!
//! Everything that used to be a Banana-only constant (strip count, level channel
//! offsets, launch code) lives here so the rest of the backend can ask "which
//! Voicemeeter is running?" instead of assuming.
//!
//! Layout facts come from the Remote API documentation (v3.1.0.1) and
//! `VoicemeeterRemote.h`:
//! - Hardware strips carry 2 level channels each, virtual strips 8 each, in
//!   strip order. Potato: `[0,2,4,6,8,10,18,26]`, Banana: `[0,2,4,6,14]`.
//! - Every bus carries 8 level channels.
//! - `VBVMR_RunVoicemeeter`: 1/2/3 = 32-bit Standard/Banana/Potato, 4/5/6 = x64.

use serde::{Deserialize, Serialize};
use std::os::raw::c_long;
use std::path::{Path, PathBuf};

pub const VM_INSTALL_DIR: &str = r"C:\Program Files (x86)\VB\Voicemeeter";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VmEdition {
    Standard,
    Banana,
    Potato,
}

/// The three virtual playback endpoints Voicemeeter exposes to Windows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VirtualInput {
    Vaio,
    Aux,
    Vaio3,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StripInfo {
    pub index: u32,
    pub label: String,
    pub is_virtual: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusInfo {
    pub index: u32,
    pub label: String,
    pub is_virtual: bool,
}

/// Everything the frontend needs to render an edition without its own tables.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionInfo {
    pub edition: VmEdition,
    pub strip_count: u32,
    pub bus_count: u32,
    pub hw_strip_count: u32,
    pub has_fx: bool,
    pub strips: Vec<StripInfo>,
    pub buses: Vec<BusInfo>,
}

impl VmEdition {
    /// Preference order when nothing else decides: newest edition first.
    pub const PREFERRED: [VmEdition; 3] =
        [VmEdition::Potato, VmEdition::Banana, VmEdition::Standard];

    /// From `VBVMR_GetVoicemeeterType`: 1 = Standard, 2 = Banana, 3 = Potato.
    pub fn from_type_code(code: i32) -> Option<Self> {
        match code {
            1 => Some(VmEdition::Standard),
            2 => Some(VmEdition::Banana),
            3 => Some(VmEdition::Potato),
            _ => None,
        }
    }

    pub fn type_code(self) -> u8 {
        match self {
            VmEdition::Standard => 1,
            VmEdition::Banana => 2,
            VmEdition::Potato => 3,
        }
    }

    pub fn hw_strip_count(self) -> u32 {
        match self {
            VmEdition::Standard => 2,
            VmEdition::Banana => 3,
            VmEdition::Potato => 5,
        }
    }

    pub fn virtual_strip_count(self) -> u32 {
        match self {
            VmEdition::Standard => 1,
            VmEdition::Banana => 2,
            VmEdition::Potato => 3,
        }
    }

    pub fn strip_count(self) -> u32 {
        self.hw_strip_count() + self.virtual_strip_count()
    }

    pub fn hw_bus_count(self) -> u32 {
        match self {
            VmEdition::Standard => 1,
            VmEdition::Banana => 3,
            VmEdition::Potato => 5,
        }
    }

    pub fn virtual_bus_count(self) -> u32 {
        match self {
            VmEdition::Standard => 1,
            VmEdition::Banana => 2,
            VmEdition::Potato => 3,
        }
    }

    pub fn bus_count(self) -> u32 {
        self.hw_bus_count() + self.virtual_bus_count()
    }

    pub fn is_virtual_strip(self, strip: u32) -> bool {
        strip >= self.hw_strip_count() && strip < self.strip_count()
    }

    /// Only Potato has the internal Reverb/Delay and external FX1/FX2 sends.
    pub fn has_fx(self) -> bool {
        self == VmEdition::Potato
    }

    /// First (L, R) level channel pair for a strip, or None if out of range.
    pub fn strip_level_channels(self, strip: u32) -> Option<(i32, i32)> {
        if strip >= self.strip_count() {
            return None;
        }
        let hw = self.hw_strip_count();
        let base = if strip < hw {
            strip * 2
        } else {
            hw * 2 + (strip - hw) * 8
        } as i32;
        Some((base, base + 1))
    }

    /// First (L, R) level channel pair for a bus, or None if out of range.
    pub fn bus_level_channels(self, bus: u32) -> Option<(i32, i32)> {
        if bus >= self.bus_count() {
            return None;
        }
        let base = (bus * 8) as i32;
        Some((base, base + 1))
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn input_channel_count(self) -> i32 {
        (self.hw_strip_count() * 2 + self.virtual_strip_count() * 8) as i32
    }

    pub fn strip_label(self, strip: u32) -> Option<String> {
        if strip >= self.strip_count() {
            return None;
        }
        let hw = self.hw_strip_count();
        Some(if strip < hw {
            format!("Hardware Input {}", strip + 1)
        } else {
            match strip - hw {
                0 => "Virtual Input".to_string(),
                1 => "Virtual Input AUX".to_string(),
                _ => "VAIO3".to_string(),
            }
        })
    }

    pub fn bus_label(self, bus: u32) -> Option<String> {
        if bus >= self.bus_count() {
            return None;
        }
        let hw = self.hw_bus_count();
        Some(if bus < hw {
            format!("A{}", bus + 1)
        } else {
            format!("B{}", bus - hw + 1)
        })
    }

    /// Strip index fed by a virtual playback endpoint, if this edition has it.
    pub fn virtual_endpoint_strip(self, kind: VirtualInput) -> Option<u32> {
        let offset = match kind {
            VirtualInput::Vaio => 0,
            VirtualInput::Aux => 1,
            VirtualInput::Vaio3 => 2,
        };
        if offset < self.virtual_strip_count() {
            Some(self.hw_strip_count() + offset)
        } else {
            None
        }
    }

    /// Potato also exposes "Voicemeeter In N" playback endpoints that feed the
    /// hardware strips directly. N is 1-based.
    pub fn hw_endpoint_strip(self, n: u32) -> Option<u32> {
        if self == VmEdition::Potato && n >= 1 && n <= self.hw_strip_count() {
            Some(n - 1)
        } else {
            None
        }
    }

    pub fn exe_name(self, x64: bool) -> &'static str {
        match (self, x64) {
            (VmEdition::Standard, false) => "voicemeeter.exe",
            (VmEdition::Standard, true) => "voicemeeter_x64.exe",
            (VmEdition::Banana, false) => "voicemeeterpro.exe",
            (VmEdition::Banana, true) => "voicemeeterpro_x64.exe",
            (VmEdition::Potato, false) => "voicemeeter8.exe",
            (VmEdition::Potato, true) => "voicemeeter8x64.exe",
        }
    }

    fn exe_path(self, x64: bool) -> PathBuf {
        Path::new(VM_INSTALL_DIR).join(self.exe_name(x64))
    }

    /// True if either build of this edition is present in the install folder.
    pub fn is_installed(self) -> bool {
        self.exe_path(true).exists() || self.exe_path(false).exists()
    }

    /// Code for `VBVMR_RunVoicemeeter`: prefer the x64 build when it exists.
    pub fn run_type_code(self) -> c_long {
        let base = self.type_code() as c_long;
        if self.exe_path(true).exists() {
            base + 3
        } else {
            base
        }
    }

    pub fn installed_editions() -> Vec<VmEdition> {
        Self::PREFERRED
            .iter()
            .copied()
            .filter(|e| e.is_installed())
            .collect()
    }

    pub fn info(self) -> EditionInfo {
        EditionInfo {
            edition: self,
            strip_count: self.strip_count(),
            bus_count: self.bus_count(),
            hw_strip_count: self.hw_strip_count(),
            has_fx: self.has_fx(),
            strips: (0..self.strip_count())
                .map(|i| StripInfo {
                    index: i,
                    label: self.strip_label(i).unwrap_or_default(),
                    is_virtual: self.is_virtual_strip(i),
                })
                .collect(),
            buses: (0..self.bus_count())
                .map(|i| BusInfo {
                    index: i,
                    label: self.bus_label(i).unwrap_or_default(),
                    is_virtual: i >= self.hw_bus_count(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bases(ed: VmEdition) -> Vec<i32> {
        (0..ed.strip_count())
            .map(|s| ed.strip_level_channels(s).unwrap().0)
            .collect()
    }

    #[test]
    fn banana_layout_matches_previous_hardcoded_table() {
        assert_eq!(bases(VmEdition::Banana), vec![0, 2, 4, 6, 14]);
        assert_eq!(VmEdition::Banana.input_channel_count(), 22);
    }

    #[test]
    fn potato_layout() {
        assert_eq!(bases(VmEdition::Potato), vec![0, 2, 4, 6, 8, 10, 18, 26]);
        assert_eq!(VmEdition::Potato.input_channel_count(), 34);
        assert_eq!(VmEdition::Potato.strip_count(), 8);
        assert_eq!(VmEdition::Potato.bus_count(), 8);
    }

    #[test]
    fn standard_layout() {
        assert_eq!(bases(VmEdition::Standard), vec![0, 2, 4]);
        assert_eq!(VmEdition::Standard.input_channel_count(), 12);
    }

    #[test]
    fn out_of_range_is_none() {
        assert_eq!(VmEdition::Banana.strip_level_channels(5), None);
        assert_eq!(VmEdition::Banana.bus_level_channels(5), None);
        assert_eq!(VmEdition::Potato.bus_level_channels(7), Some((56, 57)));
        assert_eq!(VmEdition::Banana.strip_label(5), None);
    }

    #[test]
    fn labels() {
        let p = VmEdition::Potato;
        assert_eq!(p.strip_label(0).unwrap(), "Hardware Input 1");
        assert_eq!(p.strip_label(5).unwrap(), "Virtual Input");
        assert_eq!(p.strip_label(6).unwrap(), "Virtual Input AUX");
        assert_eq!(p.strip_label(7).unwrap(), "VAIO3");
        assert_eq!(p.bus_label(4).unwrap(), "A5");
        assert_eq!(p.bus_label(5).unwrap(), "B1");
        assert_eq!(VmEdition::Banana.bus_label(3).unwrap(), "B1");
    }

    #[test]
    fn endpoint_strip_mapping() {
        assert_eq!(VmEdition::Potato.virtual_endpoint_strip(VirtualInput::Vaio), Some(5));
        assert_eq!(VmEdition::Potato.virtual_endpoint_strip(VirtualInput::Aux), Some(6));
        assert_eq!(VmEdition::Potato.virtual_endpoint_strip(VirtualInput::Vaio3), Some(7));
        assert_eq!(VmEdition::Banana.virtual_endpoint_strip(VirtualInput::Vaio), Some(3));
        assert_eq!(VmEdition::Banana.virtual_endpoint_strip(VirtualInput::Aux), Some(4));
        assert_eq!(VmEdition::Banana.virtual_endpoint_strip(VirtualInput::Vaio3), None);
        assert_eq!(VmEdition::Standard.virtual_endpoint_strip(VirtualInput::Vaio), Some(2));
        assert_eq!(VmEdition::Potato.hw_endpoint_strip(1), Some(0));
        assert_eq!(VmEdition::Potato.hw_endpoint_strip(5), Some(4));
        assert_eq!(VmEdition::Potato.hw_endpoint_strip(6), None);
        assert_eq!(VmEdition::Banana.hw_endpoint_strip(1), None);
    }

    #[test]
    fn type_codes_round_trip() {
        for ed in VmEdition::PREFERRED {
            assert_eq!(VmEdition::from_type_code(ed.type_code() as i32), Some(ed));
        }
        assert_eq!(VmEdition::from_type_code(0), None);
    }

    #[test]
    fn info_is_consistent() {
        let info = VmEdition::Potato.info();
        assert_eq!(info.strips.len(), 8);
        assert!(info.strips[5].is_virtual);
        assert!(!info.strips[4].is_virtual);
        assert_eq!(info.buses.len(), 8);
        assert!(info.has_fx);
        assert!(!VmEdition::Banana.info().has_fx);
    }
}

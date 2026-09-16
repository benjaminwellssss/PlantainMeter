//! FX preset groups: named bundles of Voicemeeter parameter values that a
//! hotkey (or a click) toggles on and off.
//!
//! Activating a group snapshots every parameter it touches, then writes the
//! preset values. Deactivating restores the snapshot. Groups are independent,
//! so several can be active at once; overlapping parameters are resolved with
//! an undo stack (see `FxInner::deactivate`) so that deactivating groups in any
//! order lands back on the original values.
//!
//! The engine is written against `ParamIo` rather than the DLL directly so it
//! can be unit-tested without Voicemeeter.

use crate::commands::VmState;
use crate::voicemeeter::VoicemeeterAPI;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub const FX_STATE_EVENT: &str = "vm:fx-state";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxAssignment {
    pub param: String,
    pub value: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub hotkey: Option<String>,
    #[serde(default)]
    pub assignments: Vec<FxAssignment>,
}

/// Ids of active groups, in activation order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxStatePayload {
    pub active: Vec<String>,
}

/// The two parameter operations the engine needs.
pub trait ParamIo {
    fn get(&self, param: &str) -> Result<f32, String>;
    fn set(&self, param: &str, value: f32) -> Result<(), String>;
}

impl ParamIo for VoicemeeterAPI {
    fn get(&self, param: &str) -> Result<f32, String> {
        self.get_float(param)
    }
    fn set(&self, param: &str, value: f32) -> Result<(), String> {
        self.set_float(param, value)
    }
}

/// Parameters a group may touch. Anything that restarts the engine, changes
/// devices, records, or streams is out of bounds for a hotkey preset.
const ALLOWED_PREFIXES: [&str; 3] = ["Strip[", "Bus[", "Fx."];

pub fn validate_param(param: &str) -> Result<(), String> {
    if ALLOWED_PREFIXES.iter().any(|p| param.starts_with(p)) {
        Ok(())
    } else {
        Err(format!("Parameter '{param}' is not allowed in an FX group"))
    }
}

struct ActiveGroup {
    id: String,
    /// (param, value before this group was applied), one entry per distinct param.
    snapshot: Vec<(String, f32)>,
}

#[derive(Default)]
pub struct FxInner {
    pub groups: Vec<FxGroup>,
    active: Vec<ActiveGroup>,
}

#[derive(Default)]
pub struct FxState(pub Mutex<FxInner>);

impl FxInner {
    pub fn is_active(&self, id: &str) -> bool {
        self.active.iter().any(|a| a.id == id)
    }

    pub fn payload(&self) -> FxStatePayload {
        FxStatePayload {
            active: self.active.iter().map(|a| a.id.clone()).collect(),
        }
    }

    pub fn clear_active(&mut self) {
        self.active.clear();
    }

    fn group(&self, id: &str) -> Result<&FxGroup, String> {
        self.groups
            .iter()
            .find(|g| g.id == id)
            .ok_or_else(|| format!("Unknown FX group '{id}'"))
    }

    /// Apply a group. Reads every touched parameter first; any read failure
    /// aborts before a single write, which also rejects parameters this
    /// edition does not have. Already-active groups are left alone.
    pub fn activate(&mut self, io: &dyn ParamIo, id: &str) -> Result<(), String> {
        if self.is_active(id) {
            return Ok(());
        }
        let group = self.group(id)?.clone();

        let mut snapshot: Vec<(String, f32)> = Vec::new();
        for a in &group.assignments {
            validate_param(&a.param)?;
            if snapshot.iter().any(|(p, _)| p == &a.param) {
                continue;
            }
            let current = io.get(&a.param)?;
            snapshot.push((a.param.clone(), current));
        }

        for a in &group.assignments {
            if let Err(e) = io.set(&a.param, a.value) {
                eprintln!("FX group '{}': set {} failed: {e}", group.name, a.param);
            }
        }

        self.active.push(ActiveGroup { id: group.id, snapshot });
        Ok(())
    }

    /// Restore a group's snapshot.
    ///
    /// Undo-stack rule: if a group activated *later* is still active and touches
    /// the same parameter, we do not write (that group currently owns the value).
    /// Instead its snapshot entry becomes our older value, so when it eventually
    /// deactivates the parameter lands on the true baseline. Only the earliest
    /// such later group is patched; the ones after it chain through it.
    pub fn deactivate(&mut self, io: &dyn ParamIo, id: &str) -> Result<(), String> {
        let Some(idx) = self.active.iter().position(|a| a.id == id) else {
            return Ok(());
        };
        let removed = self.active.remove(idx);
        // Everything from `idx` onward is now a later group.
        let (_, later) = self.active.split_at_mut(idx);

        for (param, old) in removed.snapshot {
            let owner = later
                .iter_mut()
                .find(|g| g.snapshot.iter().any(|(p, _)| p == &param));
            match owner {
                Some(g) => {
                    if let Some(entry) = g.snapshot.iter_mut().find(|(p, _)| p == &param) {
                        entry.1 = old;
                    }
                }
                None => {
                    if let Err(e) = io.set(&param, old) {
                        eprintln!("FX group '{}': restore {param} failed: {e}", removed.id);
                    }
                }
            }
        }
        Ok(())
    }

    /// Returns the new active state of the group.
    pub fn toggle(&mut self, io: &dyn ParamIo, id: &str) -> Result<bool, String> {
        if self.is_active(id) {
            self.deactivate(io, id)?;
            Ok(false)
        } else {
            self.activate(io, id)?;
            Ok(true)
        }
    }

    /// Replace the group list. Active groups that vanished or whose
    /// assignments changed are restored first (when `io` is available) or
    /// simply forgotten (when disconnected, their snapshots are stale anyway).
    pub fn sync_groups(&mut self, io: Option<&dyn ParamIo>, groups: Vec<FxGroup>) -> Result<(), String> {
        for g in &groups {
            for a in &g.assignments {
                validate_param(&a.param)?;
            }
        }

        let stale: Vec<String> = self
            .active
            .iter()
            .filter(|a| {
                let current = self.groups.iter().find(|g| g.id == a.id);
                let incoming = groups.iter().find(|g| g.id == a.id);
                match (current, incoming) {
                    (Some(c), Some(n)) => c.assignments != n.assignments,
                    _ => true,
                }
            })
            .map(|a| a.id.clone())
            .collect();

        for id in stale {
            match io {
                Some(io) => self.deactivate(io, &id)?,
                None => self.active.retain(|a| a.id != id),
            }
        }

        self.groups = groups;
        Ok(())
    }
}

fn emit_state(app: &AppHandle, payload: &FxStatePayload) {
    let _ = app.emit(FX_STATE_EVENT, payload.clone());
}

/// Toggle a group from a hotkey or a click. Takes `FxState` then `VmState.api`,
/// in that order, matching the lock order documented in hotkeys.rs.
pub fn toggle_group(app: &AppHandle, id: &str) -> Result<FxStatePayload, String> {
    let fx: State<FxState> = app.state();
    let vm: State<VmState> = app.state();
    let mut inner = fx.0.lock().map_err(|e| e.to_string())?;
    let payload = {
        let guard = vm.api.lock().map_err(|e| e.to_string())?;
        let api = guard.as_ref().ok_or("Not connected")?;
        inner.toggle(api, id)?;
        inner.payload()
    };
    emit_state(app, &payload);
    Ok(payload)
}

/// Called by the poller when the engine goes away: snapshots are meaningless
/// after Voicemeeter reloads its own config, so forget them and tell the UI.
pub fn on_connection_lost(app: &AppHandle) {
    let fx: State<FxState> = app.state();
    // Bind the lock result first: an `if let` scrutinee temporary would outlive `fx`.
    let guard = fx.0.lock();
    if let Ok(mut inner) = guard {
        if inner.active.is_empty() {
            return;
        }
        inner.clear_active();
        emit_state(app, &inner.payload());
    }
}

/// Re-announce current state (used when a connection is (re)established so a
/// freshly mounted UI has something to render).
pub fn announce(app: &AppHandle) {
    let fx: State<FxState> = app.state();
    let guard = fx.0.lock();
    if let Ok(inner) = guard {
        emit_state(app, &inner.payload());
    }
}

#[tauri::command]
pub fn vm_sync_fx_groups(
    app: AppHandle,
    fx: State<FxState>,
    vm: State<VmState>,
    groups: Vec<FxGroup>,
) -> Result<FxStatePayload, String> {
    let mut inner = fx.0.lock().map_err(|e| e.to_string())?;
    let payload = {
        let guard = vm.api.lock().map_err(|e| e.to_string())?;
        let io: Option<&dyn ParamIo> = guard.as_ref().map(|a| a as &dyn ParamIo);
        inner.sync_groups(io, groups)?;
        inner.payload()
    };
    emit_state(&app, &payload);
    Ok(payload)
}

#[tauri::command]
pub fn vm_toggle_fx_group(app: AppHandle, id: String) -> Result<FxStatePayload, String> {
    toggle_group(&app, &id)
}

#[tauri::command]
pub fn vm_get_fx_state(fx: State<FxState>) -> Result<FxStatePayload, String> {
    let inner = fx.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.payload())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    struct MockIo(RefCell<HashMap<String, f32>>);

    impl MockIo {
        fn with(pairs: &[(&str, f32)]) -> Self {
            Self(RefCell::new(
                pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            ))
        }
        fn val(&self, p: &str) -> f32 {
            *self.0.borrow().get(p).expect("param exists")
        }
    }

    impl ParamIo for MockIo {
        fn get(&self, param: &str) -> Result<f32, String> {
            self.0
                .borrow()
                .get(param)
                .copied()
                .ok_or_else(|| format!("no such param {param}"))
        }
        fn set(&self, param: &str, value: f32) -> Result<(), String> {
            if !self.0.borrow().contains_key(param) {
                return Err(format!("no such param {param}"));
            }
            self.0.borrow_mut().insert(param.to_string(), value);
            Ok(())
        }
    }

    fn group(id: &str, assignments: &[(&str, f32)]) -> FxGroup {
        FxGroup {
            id: id.into(),
            name: id.to_uppercase(),
            hotkey: None,
            assignments: assignments
                .iter()
                .map(|(p, v)| FxAssignment { param: p.to_string(), value: *v })
                .collect(),
        }
    }

    fn engine(groups: Vec<FxGroup>) -> FxInner {
        FxInner { groups, active: vec![] }
    }

    #[test]
    fn single_toggle_restores_exactly() {
        let io = MockIo::with(&[("Strip[0].Reverb", 1.5), ("Fx.Reverb.On", 0.0)]);
        let mut fx = engine(vec![group("a", &[("Strip[0].Reverb", 6.0), ("Fx.Reverb.On", 1.0)])]);

        assert!(fx.toggle(&io, "a").unwrap());
        assert_eq!(io.val("Strip[0].Reverb"), 6.0);
        assert_eq!(io.val("Fx.Reverb.On"), 1.0);
        assert_eq!(fx.payload().active, vec!["a".to_string()]);

        assert!(!fx.toggle(&io, "a").unwrap());
        assert_eq!(io.val("Strip[0].Reverb"), 1.5);
        assert_eq!(io.val("Fx.Reverb.On"), 0.0);
        assert!(fx.payload().active.is_empty());
    }

    fn overlapping() -> (MockIo, FxInner) {
        let io = MockIo::with(&[("Fx.Reverb.On", 0.0), ("Strip[0].Reverb", 1.0), ("Strip[0].Delay", 2.0)]);
        let fx = engine(vec![
            group("a", &[("Fx.Reverb.On", 1.0), ("Strip[0].Reverb", 5.0)]),
            group("b", &[("Fx.Reverb.On", 1.0), ("Strip[0].Delay", 7.0)]),
        ]);
        (io, fx)
    }

    #[test]
    fn overlap_deactivate_first_then_second_returns_to_baseline() {
        let (io, mut fx) = overlapping();
        fx.activate(&io, "a").unwrap();
        fx.activate(&io, "b").unwrap();
        assert_eq!(fx.payload().active, vec!["a".to_string(), "b".to_string()]);

        fx.deactivate(&io, "a").unwrap();
        // b still owns Fx.Reverb.On, so it must stay on; a's own param restores.
        assert_eq!(io.val("Fx.Reverb.On"), 1.0);
        assert_eq!(io.val("Strip[0].Reverb"), 1.0);
        assert_eq!(io.val("Strip[0].Delay"), 7.0);

        fx.deactivate(&io, "b").unwrap();
        assert_eq!(io.val("Fx.Reverb.On"), 0.0);
        assert_eq!(io.val("Strip[0].Delay"), 2.0);
        assert!(fx.payload().active.is_empty());
    }

    #[test]
    fn overlap_deactivate_second_then_first_returns_to_baseline() {
        let (io, mut fx) = overlapping();
        fx.activate(&io, "a").unwrap();
        fx.activate(&io, "b").unwrap();

        fx.deactivate(&io, "b").unwrap();
        // a is still active: reverb stays on (b's snapshot of it was a's value).
        assert_eq!(io.val("Fx.Reverb.On"), 1.0);
        assert_eq!(io.val("Strip[0].Delay"), 2.0);
        assert_eq!(io.val("Strip[0].Reverb"), 5.0);

        fx.deactivate(&io, "a").unwrap();
        assert_eq!(io.val("Fx.Reverb.On"), 0.0);
        assert_eq!(io.val("Strip[0].Reverb"), 1.0);
    }

    #[test]
    fn three_way_chain_restores_baseline() {
        let io = MockIo::with(&[("Fx.Reverb.On", 0.0)]);
        let mut fx = engine(vec![
            group("a", &[("Fx.Reverb.On", 1.0)]),
            group("b", &[("Fx.Reverb.On", 1.0)]),
            group("c", &[("Fx.Reverb.On", 1.0)]),
        ]);
        for id in ["a", "b", "c"] {
            fx.activate(&io, id).unwrap();
        }
        fx.deactivate(&io, "a").unwrap();
        fx.deactivate(&io, "b").unwrap();
        assert_eq!(io.val("Fx.Reverb.On"), 1.0);
        fx.deactivate(&io, "c").unwrap();
        assert_eq!(io.val("Fx.Reverb.On"), 0.0);
    }

    #[test]
    fn read_failure_writes_nothing_and_stays_inactive() {
        let io = MockIo::with(&[("Strip[0].Reverb", 1.0)]);
        let mut fx = engine(vec![group("a", &[("Strip[0].Reverb", 9.0), ("Strip[9].Reverb", 9.0)])]);
        assert!(fx.activate(&io, "a").is_err());
        assert_eq!(io.val("Strip[0].Reverb"), 1.0);
        assert!(fx.payload().active.is_empty());
    }

    #[test]
    fn sync_restores_removed_and_changed_groups() {
        let io = MockIo::with(&[("Strip[0].Reverb", 1.0), ("Strip[0].Delay", 2.0)]);
        let mut fx = engine(vec![
            group("a", &[("Strip[0].Reverb", 8.0)]),
            group("b", &[("Strip[0].Delay", 8.0)]),
        ]);
        fx.activate(&io, "a").unwrap();
        fx.activate(&io, "b").unwrap();

        // a removed, b's assignment edited: both restore.
        fx.sync_groups(Some(&io), vec![group("b", &[("Strip[0].Delay", 3.0)])]).unwrap();
        assert_eq!(io.val("Strip[0].Reverb"), 1.0);
        assert_eq!(io.val("Strip[0].Delay"), 2.0);
        assert!(fx.payload().active.is_empty());
        assert_eq!(fx.groups.len(), 1);
    }

    #[test]
    fn sync_keeps_unchanged_active_groups() {
        let io = MockIo::with(&[("Strip[0].Reverb", 1.0)]);
        let mut fx = engine(vec![group("a", &[("Strip[0].Reverb", 8.0)])]);
        fx.activate(&io, "a").unwrap();
        // Renaming / rebinding the hotkey is not a change to the applied values.
        let mut renamed = group("a", &[("Strip[0].Reverb", 8.0)]);
        renamed.name = "Cave".into();
        renamed.hotkey = Some("Alt+Numpad1".into());
        fx.sync_groups(Some(&io), vec![renamed]).unwrap();
        assert_eq!(fx.payload().active, vec!["a".to_string()]);
        assert_eq!(io.val("Strip[0].Reverb"), 8.0);
    }

    #[test]
    fn sync_without_io_forgets_stale_groups() {
        let io = MockIo::with(&[("Strip[0].Reverb", 1.0)]);
        let mut fx = engine(vec![group("a", &[("Strip[0].Reverb", 8.0)])]);
        fx.activate(&io, "a").unwrap();
        fx.sync_groups(None, vec![]).unwrap();
        assert!(fx.payload().active.is_empty());
    }

    #[test]
    fn allow_list_rejects_dangerous_params() {
        assert!(validate_param("Command.Restart").is_err());
        assert!(validate_param("Option.sr").is_err());
        assert!(validate_param("Recorder.record").is_err());
        assert!(validate_param("Strip[0].Reverb").is_ok());
        assert!(validate_param("Bus[3].ReturnDelay").is_ok());
        assert!(validate_param("Fx.Delay.AB").is_ok());

        let mut fx = engine(vec![]);
        let bad = vec![group("x", &[("Command.Restart", 1.0)])];
        assert!(fx.sync_groups(None, bad).is_err());
    }

    #[test]
    fn duplicate_params_in_one_group_snapshot_once() {
        let io = MockIo::with(&[("Strip[0].Reverb", 1.0)]);
        let mut fx = engine(vec![group("a", &[("Strip[0].Reverb", 5.0), ("Strip[0].Reverb", 7.0)])]);
        fx.activate(&io, "a").unwrap();
        assert_eq!(io.val("Strip[0].Reverb"), 7.0);
        fx.deactivate(&io, "a").unwrap();
        assert_eq!(io.val("Strip[0].Reverb"), 1.0);
    }
}

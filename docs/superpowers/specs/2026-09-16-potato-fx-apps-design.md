# MiniMeeter: Voicemeeter Potato support, per-app mixer, FX hotkeys

## Context

MiniMeeter hardcodes Voicemeeter Banana: 5 strips, Banana level-channel offsets, `RunVoicemeeter(2)`, and a 5-channel cap in Settings. The user now runs **Potato** (`voicemeeter8x64.exe` is running on this machine), which has 8 strips (5 hardware, 3 virtual), 8 buses, built-in Reverb/Delay plus external FX1/FX2 sends, and per-application volume on the virtual inputs. Three things are wanted:

1. **Potato channel support** without dropping Banana: auto-detect the edition, drive all strip/bus tables from it, and let the user pick which edition the "Launch Voicemeeter" button starts.
2. **Per-app control** as a secondary slide-over screen opened from the titlebar: apps playing into the virtual inputs, grouped by strip, each with volume, mute, and a live meter.
3. **FX hotkeys**: a hotkey toggles a named *preset bundle* (a set of Voicemeeter parameter values: sends, master Reverb/Delay on/off, A/B, bus returns). Groups are independent toggles. While any group is active, pills reading `FX1`, `FX3`, etc. appear along the bottom bar of the window.

### Decisions already made with the user
- Both editions supported via auto-detect; a **setting** chooses which edition the launch button starts (Auto / Banana / Potato).
- FX hotkey = apply a preset bundle; pressing again restores prior values.
- FX groups are independent (several can be active).
- FX indicator **always lives on the bottom accent bar** of the window (not the titlebar): one small pill per active group (`FX1`, `FX3`) laid out with spacing.

### Verified facts (official Remote API PDF v3.1.0.1 + VoicemeeterRemote.h)
- `VBVMR_GetVoicemeeterType(long*)`: 1 = Standard, 2 = Banana, 3 = Potato. Returns -2 while Voicemeeter is not running, so detect on the poller's recovered transition, not only at login.
- `VBVMR_RunVoicemeeter(n)`: 1/2/3 = 32-bit Standard/Banana/Potato, **4/5/6 = x64** builds. Current code passes `2` (32-bit Banana).
- Level input channels: hardware strips 2 ch each, virtual strips 8 ch each. Potato strip bases `[0,2,4,6,8,10,18,26]` (34 total); Banana `[0,2,4,6,14]` (22); Standard `[0,2,4]`. Buses 8 ch each: Potato 64, Banana 40.
- Potato FX params (floats): `Strip[i].Reverb|Delay|Fx1|Fx2` (0..10), `Strip[i].PostReverb|PostDelay|PostFx1|PostFx2` (0/1), `Bus[i].ReturnReverb|ReturnDelay|ReturnFx1|ReturnFx2` (0..10), `Fx.Reverb.On`, `Fx.Reverb.AB` (0=A/1=B), `Fx.Delay.On`, `Fx.Delay.AB`.
- **Per-app control through the Remote API is write-only** (`Strip[i].App[k].Gain/Mute`, `Strip[i].AppGain=("Name",g)`). No enumeration, no readback. Therefore the per-app feature uses **Windows Core Audio sessions** on the Voicemeeter render endpoints instead. Endpoint friendly names on this machine: `Voicemeeter Input`, `Voicemeeter AUX Input`, `Voicemeeter VAIO3 Input` (virtual strips), plus Potato's `Voicemeeter In 1..5` (feed hardware strips 1-5).
- `windows` 0.58 is the app's own dependency (Tauri links its own newer copy); Core Audio features go on the 0.58 entry. App-defined Tauri commands need no capability entries.

---

## Architecture overview

```
Rust (src-tauri/src)                          React (src)
─────────────────────                         ───────────
edition.rs   VmEdition + layout tables  ───►  types/edition.ts, lib/editions.ts (fallback tables)
commands.rs  poller uses edition; Connected{edition}   useVoicemeeter (edition in payload), useEditionInfo (persist lastEdition/launchEdition)
hotkeys.rs   ShortcutMap<String, HotkeyAction>  ◄──  useGlobalShortcuts(channels, fxGroups) → one vm_sync_shortcuts call
fx.rs        groups, undo-stack snapshots, vm:fx-state ──► useFxGroups, FxBar (bottom), settings/FxTab
app_sessions.rs  COM worker thread, vm:app-sessions / vm:app-levels ──► useAppSessions, AppMixerPanel
```

Lock order (document in hotkeys.rs): `ShortcutMap` → release → `FxState` → `VmState.api`. Never take `FxState` while holding `api`.

---

## Part A: Rust backend

### A1. `edition.rs` (new) + `voicemeeter.rs` + `commands.rs`
- `enum VmEdition { Standard, Banana, Potato }` (serde lowercase). Methods: `from_type_code`, `strip_count` (3/5/8), `hw_strip_count` (2/3/5), `bus_count` (2/5/8), `is_virtual_strip`, `strip_level_channels(strip) -> Option<(i32,i32)>` (hw: `strip*2`; virtual: `hw*2 + (strip-hw)*8`), `bus_level_channels(bus)` (`bus*8`), `strip_label`, `bus_label`, `has_fx` (Potato only), `virtual_endpoint_strip(kind)` (Vaio→2/3/5, Aux→-/4/6, Vaio3→-/-/7), `exe_name(x64)`, `is_installed()`, `run_type_code()` (4/5/6 when the x64 exe exists, else 1/2/3).
- `EditionInfo { edition, stripCount, busCount, hwStripCount, hasFx, strips: [{index, label, isVirtual}] }` (camelCase serde). This is what the frontend consumes; it no longer needs its own label table except as a disconnected fallback.
- `voicemeeter.rs`: add optional symbol `VBVMR_GetVoicemeeterType` and `get_voicemeeter_type()`; `run_voicemeeter(type_code)`; delete `VOICEMEETER_TYPE_BANANA`; `impl fx::ParamIo for VoicemeeterAPI`.
- `commands.rs`: `VmState.edition: AtomicU8` (0 unknown). Delete `MONITORED_STRIPS` / `strip_to_channels`; `read_strip_level` / `read_bus_level` take the edition. Poller: on `recovered`, call `get_voicemeeter_type`, store, then iterate `0..strip_count` and emit bus levels for `0..bus_count`. `VmConnection::Connected { edition: EditionInfo }` (serde `tag="state"` keeps `state === "connected"` working). `vm_get_all_strips` uses current edition. `vm_run_voicemeeter(edition: Option<VmEdition>)` resolves `edition → last detected → first installed of [Potato, Banana, Standard]`. New: `vm_list_installed_editions()`, `vm_get_edition()`.
- Tests (`#[cfg(test)]`): Banana bases equal today's `[0,2,4,6,14]`; Potato `[0,2,4,6,8,10,18,26]`; out-of-range → None; endpoint→strip mapping; channel totals 12/22/34.

### A2. `hotkeys.rs` (new): action generalization
- `enum HotkeyAction { ToggleMute { strip }, ToggleFxGroup { id } }` (serde `tag="type"`, camelCase); `struct HotkeyBinding { hotkey, action }`; `ShortcutMap { map: Mutex<HashMap<String, HotkeyAction>> }`.
- `vm_sync_shortcuts(bindings: Vec<HotkeyBinding>)` replaces the `MuteShortcutConfig` version (same unregister-all-then-register loop; skip and log duplicate normalized hotkeys). It is the **only** place that calls `unregister_all`.
- `handle_shortcut(app, &str)` looks up, clones the action, drops the lock, dispatches: ToggleMute = existing logic from `lib.rs`; ToggleFxGroup = `fx::toggle_group`. `lib.rs` handler closure becomes a one-liner.
- Tests: JSON round-trip of both variants; keep `tests/hotkey_parse.rs`.

### A3. `fx.rs` (new): preset bundles
- Model (matches store key `fxGroups`): `FxAssignment { param: String, value: f32 }`, `FxGroup { id, name, hotkey: Option<String>, assignments }`, `FxStatePayload { active: Vec<String> }` (ids in activation order).
- `trait ParamIo { get(&str)->Result<f32>; set(&str,f32)->Result<()> }` so the engine is testable without the DLL.
- `FxState(Mutex<FxInner { groups, active: Vec<ActiveGroup { id, snapshot: Vec<(String,f32)> }> }>)`.
- **Semantics (undo stack):**
  - Activate: `get` every touched param first; any read failure aborts with no writes (doubles as "param exists in this edition"). Then `set` all, push snapshot.
  - Deactivate G: for each `(p, old)` in G's snapshot: if a group activated *after* G is still active and touches `p`, do not write; patch that later group's snapshot entry for `p` to `old`. Otherwise write `old`. This gives the intuitive result in every activation/deactivation order (last-writer would leave `Fx.Reverb.On` stuck).
  - External changes in Voicemeeter's UI while active: restore snapshot anyway.
  - Allow-list param prefixes `Strip[`, `Bus[`, `Fx.`; reject `Command.`, `Option.`, `Patch.`, `Recorder.`, `vban.`. Validate at sync and activation.
  - `vm_sync_fx_groups(groups)`: deactivate (restore) any active group that vanished or whose assignments changed, replace, emit `vm:fx-state`. Does **not** touch shortcuts.
  - Poller: on healthy→unhealthy, clear `active` and emit `vm:fx-state {active: []}` (engine restart reloads Voicemeeter's saved config, snapshots are stale). No per-tick drift detection (pill means "MiniMeeter's preset is applied").
- Commands: `vm_sync_fx_groups`, `vm_toggle_fx_group(id) -> FxStatePayload`, `vm_get_fx_state`. Event `vm:fx-state`; also emit on connect so the pill resyncs.
- Tests with `MockIo(RefCell<HashMap>)`: single toggle restores exactly; A then B overlapping, deactivate A first then B → baseline; B first then A → baseline; read failure → no writes; sync removing an active group restores; allow-list rejects `Command.Restart`.

### A4. `app_sessions.rs` (new): Core Audio per-app sessions
- **Threading:** lazily started dedicated worker thread owned by managed `AppSessionsHandle { tx: Mutex<Option<Sender<SessionCmd>>> }`. Thread does `CoInitializeEx(COINIT_MULTITHREADED)` once, owns `IMMDeviceEnumerator`, the Voicemeeter render endpoints, and a cache `key -> (IAudioSessionControl2, ISimpleAudioVolume, IAudioMeterInformation)`. Commands block on a reply channel with 500 ms timeout.
- **Endpoints:** `EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)` → `OpenPropertyStore` → `PKEY_Device_FriendlyName`. Classify lowercase name: contains `voicemeeter`; `aux input` → Aux, `vaio3 input` → Vaio3, exact `voicemeeter input` → Vaio, regex `voicemeeter in (\d)` → hardware strip N-1 (Potato only). Strip via `edition.virtual_endpoint_strip` / hw index; `null` when the endpoint has no strip in the running edition.
- **Sessions:** `Activate::<IAudioSessionManager2>` → `GetSessionEnumerator` → cast `IAudioSessionControl2` (`GetProcessId`, `GetDisplayName`, `GetState`, `GetSessionInstanceIdentifier` = **key**), `ISimpleAudioVolume`, `IAudioMeterInformation`. Skip Expired; pid 0 / `IsSystemSoundsSession` → "System sounds"; display names starting with `@` treated as empty → exe stem via `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW`, cached per pid.
- **Payloads (camelCase):** `AppSession { key, pid, process, display, volume (0..1), muted, state: "active"|"inactive", peak (0..1) }`; `AppEndpoint { endpoint, kind: "vaio"|"aux"|"vaio3"|"hw", strip: number|null, sessions }`; `AppSessionsPayload { endpoints }`.
- **Polling:** `vm_set_app_polling(true)` starts a worker loop: every 66 ms emit `vm:app-levels { levels: [{key, peak}] }` from cached meters; every ~1 s re-enumerate and emit `vm:app-sessions` (full payload). Frontend disables on close.
- **Errors:** no Voicemeeter endpoints → `Ok` with empty list; COM init failure → `Err`; session gone between list and set → `Err("session gone")`.
- Commands: `vm_list_app_sessions`, `vm_set_app_volume(key, volume)`, `vm_set_app_mute(key, muted)`, `vm_set_app_polling(enabled)`.
- Tests: pure helpers only (name classification, `@` fallback, exe stem).

### A5. `Cargo.toml` / `lib.rs`
- `windows` 0.58 features to add: `Win32_Media_Audio`, `Win32_Media_Audio_Endpoints`, `Win32_System_Com`, `Win32_System_Com_StructuredStorage`, `Win32_UI_Shell_PropertiesSystem`, `Win32_System_Variant`, `Win32_Devices_FunctionDiscovery`, `Win32_System_Threading`. Confirm exact module paths at first compile.
- `lib.rs`: `mod edition; mod fx; mod hotkeys; mod app_sessions;` `.manage(FxState::default())`, `.manage(AppSessionsHandle::default())`, register new commands, delegate the shortcut handler.
- `capabilities/default.json`: unchanged.

---

## Part B: React frontend

### B1. Types and pure libs (new)
- `types/edition.ts`: `Edition`, `LaunchEdition = "auto"|"banana"|"potato"`, `EditionInfo` (mirrors Rust incl. `strips[]`).
- `lib/editions.ts`: `EDITION_DEFAULTS: Record<Edition, EditionInfo>` fallback tables for the disconnected case (same labels as Rust). `STRIP_LABELS` / `AVAILABLE_STRIPS` in `config.ts` and `SettingsPanel.tsx` are removed in favour of `edition.strips`.
- `types/fx.ts`: `FxAssignment`, `FxGroup`, `FxStatePayload`.
- `lib/fxParams.ts`: catalog `FxParamDef { key, label, target: "strip"|"bus"|"global", control: "send"|"toggle"|"ab", min, max, step, path(index?), editions }` with the Potato entries listed above; `catalogFor(edition)`, `parseParamPath(path)` (regex `^(Strip|Bus)\[(\d+)\]\.(\w+)$`, `^Fx\.(Reverb|Delay)\.(On|AB)$`), `clampValue`, `describeAssignment(a, edition, channels)` → "Mic → Reverb 6.5".
- `types/appSessions.ts`: `AppSession`, `AppEndpoint`, `AppSessionsPayload`, `AppLevelsPayload`.
- `lib/hotkey.ts`: move verbatim from `SettingsPanel.tsx`: `ModName`, `MOD_ORDER`, `MOD_LABEL`, `formatKeyLabel`, `eventToKeyToken`, `parseHotkey`, `buildHotkey`, `keyEventToAccelerator` (param typed as a `Pick<KeyboardEvent, ...>` so tests pass plain objects).
- `lib/settingsStore.ts`: memoized `getStore()`, `readKey<T>(key, fallback)`, `writeKey(key, value)`, `migrateFxGroups(raw)` (drop malformed, fill `id` via `crypto.randomUUID()`, clamp via catalog).

### B2. Edition state flow
- `hooks/useVoicemeeter.ts`: widen `VmConnectionPayload` to carry `edition?: EditionInfo`; keep `liveEdition` state set from the `vm_login` result and `vm:connection`; `launchVoicemeeter(edition: LaunchEdition)` passes `{ edition }` (undefined for auto). Return `liveEdition`.
- `hooks/useEditionInfo.ts` (new): reads/writes `lastEdition` (whole `EditionInfo`) and `launchEdition` (default `"auto"`); returns `{ edition: live ?? persisted ?? EDITION_DEFAULTS.banana, isLive, launchEdition, saveLaunchEdition }`. Single source for ChannelsTab, FxTab, AppMixerPanel, ConnectionOverlay.
- `ConnectionOverlay.tsx`: generic copy; a small Auto/Banana/Potato `<select>` next to Launch, bound to `launchEdition`. The same control also appears in the Channels tab "Edition" section (this is the user-requested setting; overlay is the convenience mirror).

### B3. SettingsPanel split (it is 738 lines)
- `SettingsPanel.tsx` becomes a shell (~220 lines): AnimatePresence, tab bar (`overflow-x-auto`), draft seeding on `open`, Save/Cancel. `Tab = "style"|"channels"|"outputs"|"fx"`. Add `fxDraft`; Save also calls `onSaveFxGroups`.
- `components/settings/shared.ts`: `inputCls`, `smallText`, `medText`, `rowLabelCls`, `sectionCls`.
- `components/settings/HotkeyRecorder.tsx`: `{ value, onChange, className? }`; owns recording state + capture-phase keydown; modifier toggles, record button, bare-key warning, clear.
- `components/settings/ChannelsTab.tsx`: draft/onChange props + `edition`, `isLive`, `launchEdition`, `onLaunchEditionChange`. Strip options from `edition.strips`; out-of-range saved strip kept as an extra option with amber ⚠ (never silently drop). Cap = `edition.stripCount`. Header: "Edition: Potato (detected)" / "Banana (last seen)" + launch select.
- `components/settings/OutputsTab.tsx`: move the device enumeration effect and helpers (`deviceKey`, `autoDisplay`, `optionsFor`, `selectDevice`).
- `components/settings/FxTab.tsx` + `FxAssignmentEditor.tsx`: group card (name, HotkeyRecorder, ▲▼ reorder since index drives the pill, ✕; expanded: assignment rows + add). Assignment row = target select (Strip N with channel label / Bus N / Global) → param select filtered by target from `catalogFor(edition)` → value control by `control` (range 0-10 with readout / on-off pill / A|B pair). Serialize via `def.path(index)`. When `!edition.hasFx` show a "FX sends require Voicemeeter Potato" note but keep editing enabled. "Read current" button is a nice-to-have, not in scope.
- Move the autostart "Startup" block into `StyleTab`.

### B4. FX runtime + pill
- `hooks/useFxGroups.ts`: `groups` from `fxGroups` (via `readKey` + `migrateFxGroups`), `saveFxGroups`, `active: string[]` from `vm:fx-state` (cleared when disconnected), `toggleGroup(id)` → `vm_toggle_fx_group`.
- `hooks/useGlobalShortcuts.ts` → `useGlobalShortcuts(channelConfigs, fxGroups)`: one effect builds `HotkeyBinding[]` (mute hotkeys + `fxGroups[].hotkey`) and calls `vm_sync_shortcuts` once; a second effect calls `vm_sync_fx_groups(groups)` on group change. (Because `vm_sync_shortcuts` does `unregister_all`, mute and FX hotkeys must always be registered together.)
- `components/FxBar.tsx`: `{ groups, active, onToggle }`. Replaces the bare bottom accent `<div>` in `App.tsx`. When no group is active it renders the current thin strip (`h-[clamp(2px,0.5dvh,4px)]`, accent background) so the default look is unchanged. While any group is active it grows to `h-[clamp(14px,4dvh,18px)]` and renders **one small pill per active group** (`FX1`, `FX3`; 1-based index in configured order), centered, `gap-[clamp(4px,1.5vw,8px)]`, `px-[clamp(6px,2vw,12px)]`, accent-fg text on `bg-black/20 rounded-[3px]`, clamp text size like the titlebar readouts. Pill `title` = group name + hotkey; clicking a pill toggles that group off. Framer `layout`/height animation so the fader area resizes smoothly. If pills exceed the width, `overflow-x-auto` with hidden scrollbar (200px fits about 4 pills).
- The titlebar is **not** touched for FX. The Titlebar only gains the Apps button (B5).

### B5. Per-app slide-over
- `hooks/useAppSessions.ts(enabled)`: on enable → `vm_list_app_sessions` for first paint, `vm_set_app_polling(true)`, listen `vm:app-sessions` and `vm:app-levels`; cleanup unlistens and `vm_set_app_polling(false)`. `setVolume/setMute` optimistic + invoke; `dragging` ref set (same pattern as `useVoicemeeter`) so incoming events don't fight a slider mid-drag. Returns `{ endpoints, levels, setVolume, setMute, startDragging, stopDragging, error }`.
- `components/AppMixerPanel.tsx`: `{ open, onClose, channels, edition, connected }`. Slides from the **bottom**: `absolute inset-0 z-[44]` (below titlebar z-45 so its button still toggles), framer `y: "100%"` spring. Backdrop click + Escape close. Header "Apps" + ✕. Per endpoint: group header = `channels.find(c => c.strip === ep.strip)?.label ?? edition.strips[ep.strip]?.label ?? ep.endpoint` with muted "Strip N". Endpoints with `strip === null` are hidden. Empty states: "No apps are playing into Voicemeeter" / "Connect to Voicemeeter first".
- `components/AppSessionRow.tsx`: `flex flex-wrap` so at 200px name+mute wrap above the slider. Native `<input type="range" 0..100>` with accent, wheel ±5, `%` readout; reuse `MuteButton`; meter = 2px accent bar under the slider, `width: peak*100%`, `transition: width 80ms linear`.
- `App.tsx`: `view: "mixer"|"apps"`; opening Settings returns to mixer. Titlebar gets `onAppsClick`, `appsOpen` (aria-pressed styling like the pin) and a grid icon after the gear.

### B6. Storage keys
Unchanged: `channels`, `outputs`, `meterDecay`, style keys. New: `fxGroups: FxGroup[]`, `launchEdition: LaunchEdition`, `lastEdition: EditionInfo`. All read with fallbacks; an old `settings.json` loads untouched.

### B7. Frontend tests (vitest, pure logic only)
Add `vitest` devDep and `"test": "vitest run"`; no jsdom. `src/lib/__tests__/`: `hotkey.test.ts` (round-trips, modifier order, numpad `e.code` precedence, lone-modifier rejection), `fxParams.test.ts` (every catalog entry round-trips `path()`→`parseParamPath()`; banana catalog excludes sends; clamp), `editions.test.ts`, `settingsStore.test.ts` (`migrateFxGroups`).

---

## Build order (one conventional commit per step; autopush handles the remote)

0. Save this design as `docs/superpowers/specs/2026-09-16-potato-fx-apps-design.md` in the project repo.
1. **Backend editions** (A1) + `cargo test`. Then **frontend editions** (B1 edition parts, B2) + ChannelsTab cap/options. Commit `feat: detect Voicemeeter edition and support Potato strips`.
2. **Settings split + hotkey lib** (B3 minus FxTab, `lib/hotkey.ts`, HotkeyRecorder, vitest scaffold). Behaviour-preserving. Commit `refactor: split settings panel into tabs`.
3. **Hotkey actions + FX engine** (A2, A3) + **FxTab, useFxGroups, FxBar** (B3 FxTab, B4). Commit `feat: FX preset groups with hotkeys and bottom-bar pills`.
4. **Core Audio sessions** (A4, A5 features) + **AppMixerPanel** (B5). Commit `feat: per-app mixer slide-over for virtual inputs`.
5. Bump version to 1.1.0 in `package.json`, `Cargo.toml`, `tauri.conf.json`; update README (Potato in title/requirements/features) and `CLAUDE.md` (edition note). Commit `chore: release 1.1.0`.

Out of scope / leave alone: the pre-existing dirty files (`package-lock.json`, `Cargo.toml` whitespace, `gen/schemas/*`, untracked `log.txt` and screenshot).

---

## Verification

- **Rust:** `cd app/src-tauri && cargo test` (edition tables, FX undo-stack with MockIo, hotkey binding serde, session-name classification, existing hotkey_parse).
- **Frontend:** `cd app && npm test` (vitest) and `npm run build` (tsc must pass).
- **Manual, Potato running:** `cd app && npx tauri dev`.
  1. Channels tab shows 8 strips with Potato labels, cap lifted; faders for strips 5-7 show live levels. Quit Voicemeeter → tab still shows "Potato (last seen)"; launch select persists across restart; Launch starts the chosen edition (verify `voicemeeter8x64.exe` appears in tasklist).
  2. Create two FX groups (e.g. G1: `Strip[0].Reverb=5`, `Fx.Reverb.On=1`; G2: `Strip[0].Delay=3`, `Fx.Delay.On=1`, `Fx.Reverb.On=1`). Press hotkeys in any order → bottom bar grows and shows `FX1`, then `FX1` `FX2`; watch Voicemeeter's own UI follow; deactivate in both orders (hotkey and pill click) → values return to baseline and the bar shrinks back. Restart engine (switch A1) → pills clear, mute hotkeys still fire afterwards.
  3. Play audio in two apps → titlebar Apps button → slide-over lists them under "Virtual Input"/user label; sliders and mute change Windows per-app volume (compare with Windows Volume Mixer), meters move; Escape/backdrop closes; polling stops (no `vm:app-levels` after close, check with a `console.log` during dev).
  4. Resize to 200x275 and repeat 2-3: FX pills stay legible and spaced along the bottom bar, the titlebar still fits its controls, app rows wrap, nothing overflows.
- **Banana regression** (if available): 5 strips, old defaults unchanged, FX tab shows the Potato note.

//! One-off utility: logs into the running Voicemeeter (Banana) via the same
//! Remote API the main app uses, and dumps every strip/bus parameter that
//! matters for recreating the setup in another Voicemeeter edition (Potato).
//! Run with `cargo run --bin dump_settings`.

use plantain_lib::voicemeeter::VoicemeeterAPI;
use std::fs::File;
use std::io::Write;
use std::thread::sleep;
use std::time::Duration;

const STRIP_FLOAT_PARAMS: &[&str] = &[
    "Gain", "Mute", "Mono", "Solo", "MC", "K", "A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3",
];
const STRIP_STRING_PARAMS: &[&str] = &["Label", "Device.name"];

const BUS_FLOAT_PARAMS: &[&str] = &["Gain", "Mute", "Mono", "EQ.on"];
const BUS_STRING_PARAMS: &[&str] = &["Label", "Device.name", "Device.wdm", "Device.asio", "Device.mme", "Device.ks"];

// https://download.vb-audio.com/Download_CABLE/VoicemeeterRemoteAPI.pdf
const VBAN_STREAM_STRING_PARAMS: &[&str] = &["name", "ip"];
const VBAN_STREAM_FLOAT_PARAMS: &[&str] = &["on", "port", "sr", "channel", "bit", "quality", "route", "bus"];

fn main() {
    let mut api = match VoicemeeterAPI::new() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("Could not load Voicemeeter Remote DLL: {e}");
            std::process::exit(1);
        }
    };

    match api.login() {
        Ok(status) => println!("Login: {status:?}"),
        Err(e) => {
            eprintln!("Login failed: {e}");
            std::process::exit(1);
        }
    }

    // Give the engine a moment and force a parameter sync.
    sleep(Duration::from_millis(300));
    let _ = api.is_dirty();

    let out_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "voicemeeter-banana-settings.txt".to_string());
    let mut out = String::new();

    out.push_str("Voicemeeter — current settings snapshot (via the Remote API)\n\n");

    for strip in 0..8u32 {
        out.push_str(&format!("=== Strip {strip} ===\n"));
        for p in STRIP_STRING_PARAMS {
            let param = format!("Strip[{strip}].{p}");
            match api.get_string(&param) {
                Ok(v) if !v.is_empty() => out.push_str(&format!("  {p} = \"{v}\"\n")),
                _ => {}
            }
        }
        for p in STRIP_FLOAT_PARAMS {
            let param = format!("Strip[{strip}].{p}");
            match api.get_float(&param) {
                Ok(v) => out.push_str(&format!("  {p} = {v}\n")),
                Err(e) => out.push_str(&format!("  {p} = <error: {e}>\n")),
            }
        }
        out.push('\n');
    }

    for bus in 0..8u32 {
        out.push_str(&format!("=== Bus {bus} ===\n"));
        for p in BUS_STRING_PARAMS {
            let param = format!("Bus[{bus}].{p}");
            match api.get_string(&param) {
                Ok(v) if !v.is_empty() => out.push_str(&format!("  {p} = \"{v}\"\n")),
                _ => {}
            }
        }
        for p in BUS_FLOAT_PARAMS {
            let param = format!("Bus[{bus}].{p}");
            match api.get_float(&param) {
                Ok(v) => out.push_str(&format!("  {p} = {v}\n")),
                Err(e) => out.push_str(&format!("  {p} = <error: {e}>\n")),
            }
        }
        out.push('\n');
    }

    out.push_str("=== VBAN ===\n");
    match api.get_float("VBAN.Enable") {
        Ok(v) => out.push_str(&format!("  Enable = {v}\n")),
        Err(e) => out.push_str(&format!("  Enable = <error: {e}>\n")),
    }
    out.push('\n');

    for i in 0..8u32 {
        let mut block = String::new();
        let mut configured = false;
        for p in VBAN_STREAM_STRING_PARAMS {
            let param = format!("VBAN.Instream[{i}].{p}");
            if let Ok(v) = api.get_string(&param) {
                if !v.is_empty() {
                    configured = true;
                    block.push_str(&format!("  {p} = \"{v}\"\n"));
                }
            }
        }
        for p in VBAN_STREAM_FLOAT_PARAMS {
            let param = format!("VBAN.Instream[{i}].{p}");
            if let Ok(v) = api.get_float(&param) {
                if p == &"on" && v > 0.0 {
                    configured = true;
                }
                block.push_str(&format!("  {p} = {v}\n"));
            }
        }
        if configured {
            out.push_str(&format!("--- VBAN Instream {i} ---\n"));
            out.push_str(&block);
            out.push('\n');
        }
    }

    for i in 0..8u32 {
        let mut block = String::new();
        let mut configured = false;
        for p in VBAN_STREAM_STRING_PARAMS {
            let param = format!("VBAN.Outstream[{i}].{p}");
            if let Ok(v) = api.get_string(&param) {
                if !v.is_empty() {
                    configured = true;
                    block.push_str(&format!("  {p} = \"{v}\"\n"));
                }
            }
        }
        for p in VBAN_STREAM_FLOAT_PARAMS {
            let param = format!("VBAN.Outstream[{i}].{p}");
            if let Ok(v) = api.get_float(&param) {
                if p == &"on" && v > 0.0 {
                    configured = true;
                }
                block.push_str(&format!("  {p} = {v}\n"));
            }
        }
        if configured {
            out.push_str(&format!("--- VBAN Outstream {i} ---\n"));
            out.push_str(&block);
            out.push('\n');
        }
    }

    out.push_str("=== Output devices Voicemeeter can see ===\n");
    for (driver, name) in api.list_output_devices() {
        out.push_str(&format!("  driver_type={driver} name=\"{name}\"\n"));
    }

    print!("{out}");

    let mut file = File::create(&out_path).expect("failed to create output file");
    file.write_all(out.as_bytes()).expect("failed to write output file");
    println!("\nWrote {out_path}");

    api.logout();
}

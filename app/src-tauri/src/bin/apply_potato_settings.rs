//! One-off migration: pushes the captured Banana settings onto Potato's
//! equivalent strips/buses (see voicemeeter-banana-settings.txt / the strip
//! mapping table). Run with `cargo run --bin apply_potato_settings`.

use plantain_lib::voicemeeter::VoicemeeterAPI;
use std::thread::sleep;
use std::time::Duration;

fn set(api: &VoicemeeterAPI, param: &str, value: f32) {
    match api.set_float(param, value) {
        Ok(()) => println!("  OK   {param} = {value}"),
        Err(e) => println!("  FAIL {param} = {value}  ({e})"),
    }
}

fn set_str(api: &VoicemeeterAPI, param: &str, value: &str) {
    match api.set_string(param, value) {
        Ok(()) => println!("  OK   {param} = \"{value}\""),
        Err(e) => println!("  FAIL {param} = \"{value}\"  ({e})"),
    }
}

fn main() {
    let mut api = VoicemeeterAPI::new().expect("DLL not found");
    let status = api.login().expect("login failed");
    println!("Login: {status:?}\n");
    sleep(Duration::from_millis(300));

    // --- Strip 0: AT2020 MIC INPUT (Banana strip 0 -> Potato strip 0) ---
    println!("Strip 0 (AT2020 MIC INPUT):");
    set_str(&api, "Strip[0].Label", "AT2020 MIC INPUT");
    set(&api, "Strip[0].Gain", -30.0);
    set(&api, "Strip[0].Mute", 0.0);
    set(&api, "Strip[0].Mono", 0.0);
    set(&api, "Strip[0].Solo", 0.0);
    set(&api, "Strip[0].A1", 0.0);
    set(&api, "Strip[0].A2", 0.0);
    set(&api, "Strip[0].A3", 0.0);
    set(&api, "Strip[0].A4", 0.0);
    set(&api, "Strip[0].A5", 0.0);
    set(&api, "Strip[0].B1", 1.0); // was B1=1 on Banana (bus index 5 here)
    set(&api, "Strip[0].B2", 0.0);
    set(&api, "Strip[0].B3", 0.0);

    // --- Strip 1: GUITAR INPUT (Banana strip 1 -> Potato strip 1) ---
    println!("\nStrip 1 (GUITAR INPUT):");
    set_str(&api, "Strip[1].Label", "GUITAR INPUT");
    set(&api, "Strip[1].Gain", 0.0);
    set(&api, "Strip[1].Mute", 0.0);
    set(&api, "Strip[1].Mono", 0.0);
    set(&api, "Strip[1].Solo", 0.0);
    // Banana had this strip routed nowhere (A1..B2 all 0) — preserved as-is.
    for p in ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3"] {
        set(&api, &format!("Strip[1].{p}"), 0.0);
    }

    // --- Strip 2: DISCORD (Banana strip 2 -> Potato strip 2) ---
    println!("\nStrip 2 (DISCORD):");
    set_str(&api, "Strip[2].Label", "DISCORD");
    set(&api, "Strip[2].Gain", -3.0);
    set(&api, "Strip[2].Mute", 0.0);
    set(&api, "Strip[2].Mono", 0.0);
    set(&api, "Strip[2].Solo", 0.0);
    set(&api, "Strip[2].A1", 1.0);
    set(&api, "Strip[2].A2", 0.0);
    set(&api, "Strip[2].A3", 0.0);
    set(&api, "Strip[2].A4", 0.0);
    set(&api, "Strip[2].A5", 0.0);
    set(&api, "Strip[2].B1", 0.0);
    set(&api, "Strip[2].B2", 1.0); // Banana B2 -> Potato bus index 6
    set(&api, "Strip[2].B3", 0.0);

    // --- Strip 5: GENERAL (Banana virtual strip 3 -> Potato virtual strip 5) ---
    println!("\nStrip 5 (GENERAL):");
    set_str(&api, "Strip[5].Label", "GENERAL");
    set(&api, "Strip[5].Gain", -4.8);
    set(&api, "Strip[5].Mute", 0.0);
    set(&api, "Strip[5].MC", 0.0);
    set(&api, "Strip[5].K", 0.0);
    set(&api, "Strip[5].Solo", 0.0);
    set(&api, "Strip[5].A1", 1.0);
    set(&api, "Strip[5].A2", 0.0);
    set(&api, "Strip[5].A3", 0.0);
    set(&api, "Strip[5].A4", 0.0);
    set(&api, "Strip[5].A5", 0.0);
    set(&api, "Strip[5].B1", 0.0);
    set(&api, "Strip[5].B2", 1.0);
    set(&api, "Strip[5].B3", 0.0);

    // --- Strip 6: MUSIC (Banana virtual strip 4 -> Potato virtual strip 6) ---
    println!("\nStrip 6 (MUSIC):");
    set_str(&api, "Strip[6].Label", "MUSIC");
    set(&api, "Strip[6].Gain", -21.0);
    set(&api, "Strip[6].Mute", 0.0);
    set(&api, "Strip[6].MC", 0.0);
    set(&api, "Strip[6].K", 4.0); // K-center, matching Banana
    set(&api, "Strip[6].Solo", 0.0);
    set(&api, "Strip[6].A1", 1.0);
    set(&api, "Strip[6].A2", 0.0);
    set(&api, "Strip[6].A3", 0.0);
    set(&api, "Strip[6].A4", 0.0);
    set(&api, "Strip[6].A5", 0.0);
    set(&api, "Strip[6].B1", 0.0);
    set(&api, "Strip[6].B2", 1.0);
    set(&api, "Strip[6].B3", 0.0);

    // --- Bus 0: A1, the main hardware output (Banana Bus 0 -> Potato Bus 0) ---
    println!("\nBus 0 (A1 — main output):");
    set(&api, "Bus[0].Gain", -6.0);
    set(&api, "Bus[0].Mute", 0.0);
    // Assign the same ASIO device Banana used. Bus device assignment needs an
    // engine restart to actually take effect.
    set_str(&api, "Bus[0].Device.asio", "UMC ASIO Driver");

    println!("\nRestarting audio engine so the device assignment takes effect...");
    let _ = api.set_float("Command.Restart", 1.0);
    sleep(Duration::from_millis(1500));

    // Re-check what the engine reports now that a real device is attached.
    println!("\nPost-restart check:");
    println!("  Bus[0].Device.name = {:?}", api.get_string("Bus[0].Device.name"));
    println!("  Bus[0].Device.sr   = {:?}", api.get_float("Bus[0].Device.sr"));

    println!("\nDone. VBAN outgoing streams (Microphones -> B1, GameMusic -> B2) and");
    println!("hardware input device assignments for strips 0-2 still need to be set");
    println!("by hand in Potato's UI — see the notes printed above this line.");

    api.logout();
}

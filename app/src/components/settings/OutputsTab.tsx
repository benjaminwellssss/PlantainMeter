import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { A1Device } from "../../config";
import { inputCls, smallText, medText, addButtonCls, removeButtonCls } from "./shared";

interface OutputsTabProps {
  draft: A1Device[];
  onChange: (next: A1Device[]) => void;
}

/** Stable identity for an output device across driver + name. */
const deviceKey = (d: { driver: string; name: string }) => `${d.driver}|${d.name}`;

/** The label auto-generated on save when the user leaves the display field blank. */
export const autoDisplay = (d: { driver: string; name: string }) =>
  `${d.driver.toUpperCase()}: ${d.name}`;

export default function OutputsTab({ draft, onChange }: OutputsTabProps) {
  // Output devices Voicemeeter can currently see. Enumerated when the tab mounts.
  const [detectedDevices, setDetectedDevices] = useState<A1Device[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<A1Device[]>("vm_list_output_devices")
      .then((devices) => {
        if (cancelled) return;
        setDetectedDevices(devices);
        setDeviceError(null);
      })
      .catch((e) => {
        if (!cancelled) setDeviceError(String(e));
      });
    return () => { cancelled = true; };
  }, []);

  const updateField = (idx: number, field: keyof A1Device, value: string) => {
    onChange(draft.map((o, i) => (i === idx ? { ...o, [field]: value } : o)));
  };

  const removeOutput = (idx: number) => {
    onChange(draft.filter((_, i) => i !== idx));
  };

  const addOutput = () => {
    const first = detectedDevices[0];
    onChange([...draft, first ? { ...first, display: "" } : { driver: "wdm", name: "", display: "" }]);
  };

  /**
   * Options for one row: everything detected, plus this row's own device if it
   * isn't currently enumerable (unplugged, or Voicemeeter not reachable) so
   * editing never silently drops a configured entry.
   */
  const optionsFor = (out: A1Device): A1Device[] => {
    if (!out.name) return detectedDevices;
    const known = detectedDevices.some((d) => deviceKey(d) === deviceKey(out));
    return known ? detectedDevices : [...detectedDevices, out];
  };

  const selectDevice = (idx: number, key: string) => {
    const match = [...detectedDevices, ...draft].find((d) => deviceKey(d) === key);
    if (!match) return;
    onChange(
      draft.map((o, i) => {
        if (i !== idx) return o;
        // Clear an auto-generated label so it regenerates for the new device;
        // keep anything the user typed themselves.
        const wasAuto = !o.display || o.display === autoDisplay(o);
        return { ...o, driver: match.driver, name: match.name, display: wasAuto ? "" : o.display };
      }),
    );
  };

  return (
    <>
      <p className={`${smallText} text-white/50 m-0`}>
        Configure A1 output device options shown in the title bar dropdown.
      </p>
      {deviceError && (
        <p className={`${smallText} text-amber-300/70 m-0`}>
          Couldn't read the device list ({deviceError}). Existing entries are still editable.
        </p>
      )}
      {!deviceError && detectedDevices.length === 0 && (
        <p className={`${smallText} text-white/40 m-0`}>
          No output devices detected — is Voicemeeter running?
        </p>
      )}
      {draft.map((out, idx) => (
        <div
          key={idx}
          className="flex flex-wrap items-center gap-[clamp(4px,1vw,8px)] bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)]"
        >
          {/* Device — driver and name come as a pair, so a typo can't produce a
              name Voicemeeter will silently reject. */}
          <select
            className={`${inputCls} ${medText} px-[clamp(3px,0.5vw,6px)] py-[2px] flex-1 min-w-[clamp(100px,24vw,200px)] cursor-pointer`}
            style={{ colorScheme: "dark" }}
            value={out.name ? deviceKey(out) : ""}
            onChange={(e) => selectDevice(idx, e.target.value)}
          >
            {!out.name && <option value="">Select a device…</option>}
            {optionsFor(out).map((d) => (
              <option key={deviceKey(d)} value={deviceKey(d)}>
                {autoDisplay(d)}
              </option>
            ))}
          </select>

          <input
            className={`${inputCls} ${medText} px-[clamp(3px,0.5vw,6px)] py-[2px] flex-1 min-w-[clamp(60px,15vw,120px)]`}
            value={out.display}
            onChange={(e) => updateField(idx, "display", e.target.value)}
            placeholder="Display label (auto)"
          />

          <button className={removeButtonCls} onClick={() => removeOutput(idx)} title="Remove output">
            ✕
          </button>
        </div>
      ))}

      <button className={addButtonCls} onClick={addOutput}>
        + Add Output Device
      </button>
    </>
  );
}

import { describe, it, expect } from "vitest";
import {
  FX_PARAMS,
  parseParamPath,
  clampValue,
  formatValue,
  describeAssignment,
  paramsForTarget,
} from "../fxParams";
import { EDITION_DEFAULTS } from "../editions";

describe("FX parameter catalog", () => {
  it("every entry round-trips through path() and parseParamPath()", () => {
    for (const def of FX_PARAMS) {
      const index = def.target === "global" ? undefined : 3;
      const path = def.path(index);
      const parsed = parseParamPath(path);
      expect(parsed, path).not.toBeNull();
      expect(parsed!.def.key).toBe(def.key);
      expect(parsed!.index).toBe(index);
    }
  });

  it("produces the documented Voicemeeter parameter names", () => {
    const keys = Object.fromEntries(FX_PARAMS.map((p) => [p.key, p]));
    expect(keys["strip.reverb"].path(0)).toBe("Strip[0].Reverb");
    expect(keys["strip.postFx2"].path(4)).toBe("Strip[4].PostFx2");
    expect(keys["bus.returnDelay"].path(5)).toBe("Bus[5].ReturnDelay");
    expect(keys["fx.reverbOn"].path()).toBe("Fx.Reverb.On");
    expect(keys["fx.delayAB"].path()).toBe("Fx.Delay.AB");
  });

  it("rejects unknown paths", () => {
    expect(parseParamPath("Command.Restart")).toBeNull();
    expect(parseParamPath("Strip[0].Gain")).toBeNull();
    expect(parseParamPath("Fx.Reverb.Nope")).toBeNull();
  });

  it("groups params by target", () => {
    expect(paramsForTarget("global").map((p) => p.key)).toEqual([
      "fx.reverbOn",
      "fx.reverbAB",
      "fx.delayOn",
      "fx.delayAB",
    ]);
    expect(paramsForTarget("bus")).toHaveLength(4);
    expect(paramsForTarget("strip")).toHaveLength(8);
  });

  it("clamps and formats by control type", () => {
    const send = parseParamPath("Strip[0].Reverb")!.def;
    expect(clampValue(send, 12)).toBe(10);
    expect(clampValue(send, -1)).toBe(0);
    expect(clampValue(send, NaN)).toBe(0);
    expect(formatValue(send, 6)).toBe("6.0");
    const toggle = parseParamPath("Fx.Reverb.On")!.def;
    expect(formatValue(toggle, 1)).toBe("on");
    const ab = parseParamPath("Fx.Delay.AB")!.def;
    expect(formatValue(ab, 1)).toBe("B");
  });

  it("describes assignments with channel labels when available", () => {
    const edition = EDITION_DEFAULTS.potato;
    const channels = [{ label: "Mic", strip: 0, hasMute: true, minDb: -30, maxDb: 9, defaultDb: 0 }];
    expect(describeAssignment({ param: "Strip[0].Reverb", value: 6 }, edition, channels)).toBe(
      "Mic → Reverb send 6.0",
    );
    expect(describeAssignment({ param: "Strip[5].Delay", value: 2 }, edition, channels)).toBe(
      "Virtual Input → Delay send 2.0",
    );
    expect(describeAssignment({ param: "Bus[0].ReturnReverb", value: 4 }, edition, channels)).toBe(
      "Bus A1 → Reverb return 4.0",
    );
    expect(describeAssignment({ param: "Fx.Reverb.On", value: 1 }, edition, channels)).toBe(
      "Master FX → Reverb on",
    );
    expect(describeAssignment({ param: "Weird.Param", value: 1 }, edition, channels)).toBe(
      "Weird.Param = 1",
    );
  });
});

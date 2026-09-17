import { describe, it, expect } from "vitest";
import { hideKey, parseHideKey, migrateHidden, buildScopes } from "../hiddenApps";
import type { AppEndpoint } from "../../types/appSessions";

const ep = (endpoint: string, kind: AppEndpoint["kind"], strip: number | null): AppEndpoint => ({
  endpoint,
  kind,
  strip,
  sessions: [],
});

describe("buildScopes", () => {
  it("names a virtual input after its kind", () => {
    const scopes = buildScopes([ep("Voicemeeter Input", "vaio", 5), ep("Voicemeeter Aux Input", "aux", 6)]);
    expect(scopes.get("Voicemeeter Input")).toBe("vaio");
    expect(scopes.get("Voicemeeter Aux Input")).toBe("aux");
  });

  it("numbers hardware inputs so they do not share one scope", () => {
    const scopes = buildScopes([
      ep("Voicemeeter In 1", "hw", 0),
      ep("Voicemeeter In 2", "hw", 1),
      ep("Voicemeeter Input", "vaio", 5),
    ]);
    expect(scopes.get("Voicemeeter In 1")).toBe("hw1");
    expect(scopes.get("Voicemeeter In 2")).toBe("hw2");
  });

  it("numbers hardware inputs independently of unrouted endpoints", () => {
    // strip null just means the running edition has no strip for it; the scope
    // must not shift when an edition change routes one more of them.
    const scopes = buildScopes([ep("Voicemeeter In 1", "hw", null), ep("Voicemeeter In 2", "hw", 1)]);
    expect(scopes.get("Voicemeeter In 2")).toBe("hw2");
  });
});

describe("hideKey", () => {
  it("scopes the executable name to the endpoint it was hidden under", () => {
    expect(hideKey("vaio", { process: "Spotify", display: "Spotify" })).toBe("vaio:spotify");
  });

  it("gives the same app a separate key per endpoint", () => {
    const session = { process: "Spotify", display: "Spotify" };
    expect(hideKey("vaio", session)).not.toBe(hideKey("aux", session));
    expect(hideKey("hw1", session)).not.toBe(hideKey("hw2", session));
  });

  it("falls back to the display name when there is no process name", () => {
    expect(hideKey("aux", { process: "", display: "System sounds" })).toBe("aux:system sounds");
  });
});

describe("parseHideKey", () => {
  it("splits a scoped entry", () => {
    expect(parseHideKey("vaio3:chrome")).toEqual({ scope: "vaio3", name: "chrome" });
    expect(parseHideKey("hw2:chrome")).toEqual({ scope: "hw2", name: "chrome" });
  });

  it("reports an unscoped entry as legacy", () => {
    expect(parseHideKey("chrome")).toEqual({ scope: null, name: "chrome" });
  });

  it("keeps colons that belong to the app name", () => {
    expect(parseHideKey("hw1:foo: bar")).toEqual({ scope: "hw1", name: "foo: bar" });
    expect(parseHideKey("foo: bar")).toEqual({ scope: null, name: "foo: bar" });
  });
});

describe("migrateHidden", () => {
  it("expands a legacy entry into one scoped entry per endpoint", () => {
    expect(migrateHidden(["chrome"], ["vaio", "aux"])).toEqual(["vaio:chrome", "aux:chrome"]);
  });

  it("leaves already-scoped entries alone", () => {
    expect(migrateHidden(["spotify", "aux:chrome"], ["vaio", "aux"])).toEqual([
      "aux:chrome",
      "vaio:spotify",
      "aux:spotify",
    ]);
  });

  it("does not duplicate an entry the legacy expansion would recreate", () => {
    expect(migrateHidden(["chrome", "aux:chrome"], ["vaio", "aux"])).toEqual(["aux:chrome", "vaio:chrome"]);
  });

  it("returns the same list when there is nothing to migrate", () => {
    const list = ["vaio:spotify"];
    expect(migrateHidden(list, ["vaio", "aux"])).toBe(list);
  });

  it("leaves legacy entries untouched until the endpoints are known", () => {
    const list = ["spotify"];
    expect(migrateHidden(list, [])).toBe(list);
  });
});

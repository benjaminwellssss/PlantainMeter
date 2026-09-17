import type { FxGroup, FxAssignment } from "../types/fx";
import { parseParamPath, clampValue } from "./fxParams";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newGroup(index: number): FxGroup {
  return { id: newId(), name: `FX ${index}`, hotkey: "", assignments: [] };
}

/**
 * Coerce whatever is in the store into a valid group list: drop garbage,
 * fill in missing ids, clamp known parameters to their ranges. Unknown but
 * well-formed parameter paths are kept as-is so a newer catalog never deletes
 * a user's data.
 */
export function migrateFxGroups(raw: unknown): FxGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: FxGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const name = typeof g.name === "string" ? g.name : "";
    const hotkey = typeof g.hotkey === "string" ? g.hotkey : "";
    const assignments: FxAssignment[] = [];
    if (Array.isArray(g.assignments)) {
      for (const a of g.assignments) {
        if (!a || typeof a !== "object") continue;
        const { param, value } = a as Record<string, unknown>;
        if (typeof param !== "string" || !param) continue;
        const num = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(num)) continue;
        const parsed = parseParamPath(param);
        assignments.push({ param, value: parsed ? clampValue(parsed.def, num) : num });
      }
    }
    out.push({
      id: typeof g.id === "string" && g.id ? g.id : newId(),
      name: name || `FX ${out.length + 1}`,
      hotkey,
      assignments,
    });
  }
  return out;
}

/**
 * Text for a group's pill on the FX bar: its own name, falling back to its
 * position so a group whose name was cleared still shows something.
 */
export function pillLabel(name: string, position: number): string {
  return name.trim() || `FX ${position}`;
}

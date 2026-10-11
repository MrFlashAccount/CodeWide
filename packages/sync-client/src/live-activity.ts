import type { ThreadProjectionPatchV1 } from "./thread-events";

/** Patch operation field carrying a Companion-published live activity change. */
export const LIVE_ACTIVITY_FIELD = "liveActivity";

/** What a running thread's agent is doing now, as the Companion reduced it. */
export type LiveActivity =
  | { readonly kind: "reasoning"; readonly title: string }
  | { readonly kind: "planStep"; readonly step: string }
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "fileEdit"; readonly path: string; readonly more: number }
  | { readonly kind: "tool"; readonly server: string | null; readonly tool: string }
  | { readonly kind: "webSearch" }
  | { readonly kind: "compacting" };

/** A change a patch publishes: absent from the patch means unchanged. */
export type LiveActivityChange =
  | { readonly type: "set"; readonly activity: LiveActivity }
  | { readonly type: "cleared" };

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  // WHY: object validation establishes string-keyed property access; every
  // field is validated below before entering the project contract.
  return value as Record<string, unknown>;
}

function label(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Validates one wire activity; an unknown or malformed value is rejected. */
export function parseLiveActivity(value: unknown): LiveActivity | null {
  const r = record(value);
  switch (r?.kind) {
    case "reasoning":
      return label(r.title) ? { kind: "reasoning", title: r.title } : null;
    case "planStep":
      return label(r.step) ? { kind: "planStep", step: r.step } : null;
    case "command":
      return label(r.command) ? { kind: "command", command: r.command } : null;
    case "fileEdit":
      return label(r.path) && typeof r.more === "number" && Number.isSafeInteger(r.more) && r.more >= 0
        ? { kind: "fileEdit", path: r.path, more: r.more }
        : null;
    case "tool":
      return label(r.tool) && (r.server === null || label(r.server))
        ? { kind: "tool", server: r.server, tool: r.tool }
        : null;
    case "webSearch":
      return { kind: "webSearch" };
    case "compacting":
      return { kind: "compacting" };
    default:
      return null;
  }
}

/**
 * Reads the live activity change of one patch. A missing field changes
 * nothing; `null` clears the activity. A value this client cannot read also
 * clears it, so a newer Companion never leaves a stale label behind.
 */
export function liveActivityChangeFromPatch(patch: ThreadProjectionPatchV1): LiveActivityChange | null {
  if (!(LIVE_ACTIVITY_FIELD in patch.operation)) return null;
  const activity = parseLiveActivity(patch.operation[LIVE_ACTIVITY_FIELD]);
  return activity === null ? { type: "cleared" } : { type: "set", activity };
}

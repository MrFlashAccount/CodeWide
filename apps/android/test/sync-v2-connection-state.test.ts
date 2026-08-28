import { describe, expect, it } from "vitest";

import { projectSyncV2ConnectionState } from "../src/data/sync-v2-connection-state.js";

describe("Sync V2 connection presentation", () => {
  it("projects initialization states without exposing protocol payload details", () => {
    expect(projectSyncV2ConnectionState("initializing", null)).toEqual({ state: "syncing", diagnostic: null });
    expect(projectSyncV2ConnectionState("reinitializing", { code: "reinitialize", detail: "queueOverflow" })).toEqual({
      state: "syncing",
      diagnostic: "Sync V2 is rebuilding authoritative state",
    });
  });

  it("uses bounded diagnostics instead of forwarding arbitrary detail", () => {
    expect(projectSyncV2ConnectionState("error", { code: "protocol", detail: "private payload" })).toEqual({
      state: "degraded",
      diagnostic: "Sync V2 protocol validation failed",
    });
  });
});

import { describe, expect, it } from "vitest";

import { resolveNewThreadRoute } from "../src/features/projects/newThreadRouting";

describe("new thread routing", () => {
  it("opens server setup when no server exists", () => {
    expect(resolveNewThreadRoute({ serverScope: { kind: "all" }, serverIds: [] }))
      .toEqual({ type: "connect-server" });
  });

  it("uses the only server without opening a chooser", () => {
    expect(resolveNewThreadRoute({ serverScope: { kind: "all" }, serverIds: ["orbit"] }))
      .toEqual({ type: "create", serverId: "orbit" });
  });

  it("uses the selected server without opening a chooser", () => {
    expect(resolveNewThreadRoute({
      serverScope: { kind: "connection", connectionId: "lab" },
      serverIds: ["orbit", "lab"],
    }))
      .toEqual({ type: "create", serverId: "lab" });
  });

  it("asks only when all servers are selected and several are available", () => {
    expect(resolveNewThreadRoute({
      serverScope: { kind: "all" },
      serverIds: ["orbit", "lab"],
    }))
      .toEqual({ type: "choose-server" });
  });

  it("does not target a stale selected server", () => {
    expect(resolveNewThreadRoute({
      serverScope: { kind: "connection", connectionId: "removed" },
      serverIds: ["orbit", "lab"],
    }))
      .toEqual({ type: "choose-server" });
  });
});

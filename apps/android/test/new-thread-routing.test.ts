import { describe, expect, it } from "vitest";

import { resolveNewThreadRoute } from "../src/data/new-thread-routing";

const ALL_SERVERS_ID = "__all_servers__";

describe("new thread routing", () => {
  it("opens server setup when no server exists", () => {
    expect(resolveNewThreadRoute({ activeServerId: ALL_SERVERS_ID, allServersId: ALL_SERVERS_ID, serverIds: [] }))
      .toEqual({ type: "connect-server" });
  });

  it("uses the only server without opening a chooser", () => {
    expect(resolveNewThreadRoute({ activeServerId: ALL_SERVERS_ID, allServersId: ALL_SERVERS_ID, serverIds: ["orbit"] }))
      .toEqual({ type: "create", serverId: "orbit" });
  });

  it("uses the selected server without opening a chooser", () => {
    expect(resolveNewThreadRoute({ activeServerId: "lab", allServersId: ALL_SERVERS_ID, serverIds: ["orbit", "lab"] }))
      .toEqual({ type: "create", serverId: "lab" });
  });

  it("asks only when all servers are selected and several are available", () => {
    expect(resolveNewThreadRoute({ activeServerId: ALL_SERVERS_ID, allServersId: ALL_SERVERS_ID, serverIds: ["orbit", "lab"] }))
      .toEqual({ type: "choose-server" });
  });

  it("does not target a stale selected server", () => {
    expect(resolveNewThreadRoute({ activeServerId: "removed", allServersId: ALL_SERVERS_ID, serverIds: ["orbit", "lab"] }))
      .toEqual({ type: "choose-server" });
  });
});

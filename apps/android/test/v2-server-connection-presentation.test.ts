import { describe, expect, it } from "vitest";

import {
  aggregateConnectionLabel,
  aggregateConnectionState,
  serverConnectionLabel,
  serverConnectionRows,
} from "../src/v2/features/serverList/serverConnectionPresentation";
import { savedServerId } from "../src/v2/domain/ids";

describe("V2 server connection presentation", () => {
  it("derives aggregate state from every enabled server", () => {
    const first = server("first", true);
    const second = server("second", true);
    const statuses = new Map([
      [first.id, { detail: null, state: "connected" as const }],
      [second.id, { detail: null, state: "connecting" as const }],
    ]);

    expect(aggregateConnectionState([first, second], statuses)).toBe("initializing");
    expect(aggregateConnectionLabel([first, second], statuses)).toBe("1 of 2 live");
  });

  it("never labels missing or failed connection state as live", () => {
    expect(serverConnectionLabel(undefined, true)).toBe("Connecting");
    expect(serverConnectionLabel({ detail: "failed", state: "error" }, true)).toBe(
      "Connection error",
    );
    expect(serverConnectionLabel(undefined, false)).toBe("Disabled");
  });

  it("projects every wide-rail row from authoritative connection status", () => {
    const statuses = [
      ["connecting", { detail: null, state: "connecting" as const }],
      ["updating", { detail: null, state: "updating" as const }],
      ["offline", { detail: null, state: "offline" as const }],
      ["error", { detail: "failed", state: "error" as const }],
    ] as const;
    const servers = statuses.map(([id]) => server(id, true));
    const statusMap = new Map(statuses.map(([id, status]) => [savedServerId(id), status]));

    expect(serverConnectionRows(servers, statusMap).map((row) => row.detail)).toEqual([
      "Connecting",
      "Updating",
      "Offline",
      "Connection error",
    ]);
  });
});

function server(id: string, enabled: boolean) {
  return {
    displayName: id,
    emoji: "🖥️",
    enabled,
    endpoint: `https://${id}.example`,
    id: savedServerId(id),
  };
}

import type { SyncV2SessionSnapshot } from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { ObservableResource } from "../src/v2/application/resources/resource";
import { ServerConnectionStatusesResource } from "../src/v2/application/resources/serverConnectionStatusesResource";
import { savedServerId } from "../src/v2/domain/ids";

const EMPTY_SESSION: SyncV2SessionSnapshot = {
  operations: [],
  projections: { live: null, retained: null },
  state: "offline",
  version: 0,
};

describe("V2 server connection statuses", () => {
  it("publishes real session transitions and keeps disabled servers offline", async () => {
    const source = new ObservableResource<SyncV2SessionSnapshot>(EMPTY_SESSION);
    let diagnostic: { code: "reinitialize"; detail: string } | null = null;
    const open = vi.fn(async () => ({
      resource: source,
      session: { safeDiagnostic: () => diagnostic },
    }));
    const statuses = new ServerConnectionStatusesResource({ open });
    const enabledId = savedServerId("enabled-server");
    const disabledId = savedServerId("disabled-server");

    statuses.replaceServers([savedServer(enabledId, true), savedServer(disabledId, false)]);

    expect(statuses.snapshot().value.get(enabledId)?.state).toBe("connecting");
    expect(statuses.snapshot().value.get(disabledId)?.state).toBe("disabled");
    expect(open).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(statuses.snapshot().value.get(enabledId)?.state).toBe("connecting");
    });

    diagnostic = { code: "reinitialize", detail: "sourceGap" };
    source.publish({
      status: "ready",
      value: { ...EMPTY_SESSION, state: "reinitializing", version: 1 },
    });
    expect(statuses.snapshot().value.get(enabledId)).toEqual({
      detail: "sourceGap",
      state: "updating",
    });

    source.publish({
      status: "ready",
      value: { ...EMPTY_SESSION, state: "live", version: 2 },
    });
    expect(statuses.snapshot().value.get(enabledId)).toEqual({ detail: null, state: "connected" });

    source.publish({ status: "ready", value: { ...EMPTY_SESSION, version: 3 } });
    expect(statuses.snapshot().value.get(enabledId)).toEqual({ detail: null, state: "offline" });

    statuses.reconnect(enabledId);
    expect(statuses.snapshot().value.get(enabledId)).toEqual({ detail: null, state: "connecting" });
  });

  it("classifies authorization failures as user-action-required diagnostics", async () => {
    const id = savedServerId("server");
    const source = new ObservableResource<SyncV2SessionSnapshot>(EMPTY_SESSION);
    let shouldFail = true;
    const open = vi.fn(() =>
      shouldFail
        ? Promise.reject(new Error("Authorization required"))
        : Promise.resolve({ resource: source, session: { safeDiagnostic: () => null } }),
    );
    const statuses = new ServerConnectionStatusesResource({ open });

    statuses.replaceServers([savedServer(id, true)]);

    await vi.waitFor(() => {
      expect(statuses.snapshot().value.get(id)).toEqual({
        detail: "Authorization required",
        state: "accessRequired",
      });
    });

    shouldFail = false;
    source.publish({
      status: "ready",
      value: { ...EMPTY_SESSION, state: "live", version: 1 },
    });
    statuses.reconnect(id);
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledTimes(2);
      expect(statuses.snapshot().value.get(id)).toEqual({ detail: null, state: "connected" });
    });
  });
});

function savedServer(id: ReturnType<typeof savedServerId>, enabled: boolean) {
  return {
    displayName: "Buddy",
    emoji: "🖥️",
    enabled,
    endpoint: "https://buddy.example",
    id,
  };
}

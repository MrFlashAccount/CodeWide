import { describe, expect, it, vi } from "vitest";

import { connectionDisplayState, createConnectionStateModel } from "../src/data/connection-state-model";

describe("connection state model", () => {
  it("starts enabled profiles as connecting instead of restoring a durable live state", () => {
    const model = createConnectionStateModel();

    model.reconcileProfiles([{ id: "buddy", connectionId: "buddy", enabled: true }]);

    expect(model.rows$.peek()).toEqual([{
      id: "buddy",
      connectionId: "buddy",
      enabled: true,
      state: "connecting",
      rpcAvailable: false,
      lastError: null,
      lastErrorAt: null,
    }]);
  });

  it("keeps transport state and RPC availability in one native-owned snapshot", () => {
    const model = createConnectionStateModel();
    model.reconcileProfiles([{ id: "buddy", connectionId: "buddy", enabled: true }]);

    model.setState("buddy", "syncing", undefined, true);
    model.setState("buddy", "live", null, true);

    expect(model.rows$.peek()[0]).toMatchObject({ state: "live", rpcAvailable: true });
  });

  it("never presents syncing or live without RPC availability as connected", () => {
    expect(connectionDisplayState({ state: "live", rpcAvailable: false })).toBe("connecting");
    expect(connectionDisplayState({ state: "syncing", rpcAvailable: false })).toBe("connecting");
    expect(connectionDisplayState({ state: "syncing", rpcAvailable: true })).toBe("syncing");
    expect(connectionDisplayState({ state: "live", rpcAvailable: true })).toBe("live");
  });

  it("publishes runtime changes without persistence or duplicate notifications", () => {
    const model = createConnectionStateModel();
    model.reconcileProfiles([{ id: "buddy", connectionId: "buddy", enabled: true }]);
    const listener = vi.fn();
    const subscription = model.subscribeChanges(listener, { includeInitialState: true });

    model.setState("buddy", "connecting", null, false);
    model.setState("buddy", "live", null, true);
    model.setState("buddy", "live", null, true);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toMatchObject({ state: "live", rpcAvailable: true });
    subscription.unsubscribe();
  });

  it("resets a re-enabled profile to connecting with RPC unavailable", () => {
    const model = createConnectionStateModel();
    model.reconcileProfiles([{ id: "buddy", connectionId: "buddy", enabled: true }]);
    model.setState("buddy", "live", null, true);

    model.reconcileProfiles([{ id: "buddy", connectionId: "buddy", enabled: false }]);
    model.reconcileProfiles([{ id: "buddy", connectionId: "buddy", enabled: true }]);

    expect(model.rows$.peek()[0]).toMatchObject({ enabled: true, state: "connecting", rpcAvailable: false });
  });
});

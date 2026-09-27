import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionStateModel } from "../src/data/connection-state-model";
import { parseConnectionPath, type NetworkObservation } from "../src/data/connectionPath";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture() {
  const model = createConnectionStateModel();
  model.reconcileProfiles([{ id: "home", connectionId: "home", enabled: true }]);
  return {
    model,
    health: () => model.health$.peek().home,
    path(status: NetworkObservation["status"], companion = "backoff", appServer = "unknown") {
      model.setPath("home", parseConnectionPath({ network: { status, epoch: 1 }, companion, appServer }));
    },
    live: () => model.setState("home", "live", null, true),
    down: () => model.setState("home", "connecting", undefined, false),
  };
}

describe("event-driven connection presentation", () => {
  it("shows loss immediately and has no polling or presentation timers", () => {
    const input = fixture();
    input.live();
    expect(input.health()).toBe("online");
    input.path("noDefaultNetwork", "waitingForNetwork");
    input.down();
    expect(input.health()).toBe("noConnection");
    input.path("validated", "connecting");
    expect(input.health()).toBe("reconnecting");
    input.path("validated", "backoff");
    expect(input.health()).toBe("serviceUnavailable");
    input.live();
    expect(input.health()).toBe("online");
    expect(vi.getTimerCount()).toBe(0);
    input.model.close();
  });

  it("does not call an unvalidated but working LAN/VPN offline", () => {
    const input = fixture();
    input.path("unvalidated", "connected", "live");
    input.live();
    expect(input.health()).toBe("online");
    input.model.setState("home", "syncing", null, true);
    expect(input.health()).toBe("online");
    input.path("unvalidated", "connected", "reconnecting");
    input.down();
    expect(input.health()).toBe("serviceUnavailable");
    input.model.close();
  });

  it("preserves authorization and delivery failures independently of network facts", () => {
    const input = fixture();
    input.model.setState("home", "authRequired", null, false);
    expect(input.health()).toBe("authRequired");
    input.model.setState("home", "degraded", "Local projection failed", true);
    expect(input.health()).toBe("connectionError");
    expect(input.model.rows$.peek()[0]?.lastError).toBe("Local projection failed");
    input.model.close();
  });

  it("validates additive native facts while old binaries remain explicitly unknown", () => {
    expect(parseConnectionPath(undefined)).toBeNull();
    for (const input of [null, {}, { network: { status: "validated", epoch: -1 } },
      { network: { status: "madeUp", epoch: 0 }, companion: "connected", appServer: "live" },
      { network: { status: "validated", epoch: 0 }, companion: "connected", appServer: "madeUp" }]) {
      expect(() => parseConnectionPath(input)).toThrow();
    }
  });

  it("publishes repeated capabilities only to presentation, with no reconnect notification", () => {
    const input = fixture();
    const changes = vi.fn();
    input.model.subscribeChanges(changes);
    for (let index = 0; index < 100; index += 1) {
      input.path(index % 2 === 0 ? "unvalidated" : "validated");
    }
    input.path("noDefaultNetwork", "waitingForNetwork");
    expect(input.health()).toBe("noConnection");
    expect(changes).not.toHaveBeenCalled();
    input.model.remove("home");
    expect(input.health()).toBeUndefined();
    input.model.reconcileProfiles([{ id: "home", connectionId: "home", enabled: true }]);
    expect(input.health()).toBe("reconnecting");
    input.model.close();
    input.path("noDefaultNetwork", "waitingForNetwork");
    expect(input.model.health$.peek()).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });
});

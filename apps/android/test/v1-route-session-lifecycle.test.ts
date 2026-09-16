import { afterEach, describe, expect, it, vi } from "vitest";

import {
  disposeAllRouteSessions,
  RouteSessionRegistry,
} from "../src/services/routeSessionPolicy";
import { SearchRouteSessionService } from "../src/services/search/searchRouteSession";
import { workspaceRouteSessionOwner } from "../src/services/threads/threadRouteParams";

afterEach(() => {
  disposeAllRouteSessions();
  vi.useRealTimers();
});

describe("V1 route-session lifecycle", () => {
  it("retires at the deadline without a later registry access", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cleanup = vi.fn();
    const registry = new RouteSessionRegistry<{ readonly id: string; touchedAt: number }>({
      cleanup,
      limit: 2,
      ttlMs: 100,
    });
    const entry = { id: "deadline", touchedAt: Date.now() };
    expect(registry.admit(entry)).toBe(true);

    vi.advanceTimersByTime(100);

    expect(cleanup).toHaveBeenCalledWith(entry);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("uses the same exactly-once cleanup for capacity, close, and workspace disposal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cleanup = vi.fn();
    const registry = new RouteSessionRegistry<{ readonly id: string; touchedAt: number }>({
      cleanup,
      limit: 1,
      ttlMs: 100,
    });
    const capacityVictim = { id: "capacity", touchedAt: Date.now() };
    registry.admit(capacityVictim);
    vi.setSystemTime(1);
    const closed = { id: "closed", touchedAt: Date.now() };
    registry.admit(closed);
    registry.close(closed.id);
    registry.close(closed.id);
    const disposed = { id: "disposed", touchedAt: Date.now() };
    registry.admit(disposed);
    disposeAllRouteSessions();
    disposeAllRouteSessions();

    expect(cleanup.mock.calls).toEqual([[capacityVictim], [closed], [disposed]]);
  });

  it("protects a retained destination from passive expiry and capacity eviction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cleanup = vi.fn();
    const registry = new RouteSessionRegistry<{ readonly id: string; touchedAt: number }>({
      cleanup,
      limit: 1,
      ttlMs: 100,
    });
    const mounted = { id: "mounted", touchedAt: Date.now() };
    registry.admit(mounted);
    const release = registry.retain(mounted.id);

    vi.advanceTimersByTime(100);
    const adjacent = { id: "adjacent", touchedAt: Date.now() };
    expect(registry.admit(adjacent)).toBe(true);
    expect(registry.get(mounted.id)).toBe(mounted);
    expect(cleanup).not.toHaveBeenCalledWith(mounted);

    release();
    vi.advanceTimersByTime(100);
    expect(registry.get(mounted.id)).toBeNull();
    expect(cleanup).toHaveBeenCalledWith(mounted);
  });

  it("cancels the exact search session evicted for capacity before its debounce fires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const service = new SearchRouteSessionService();
    const evicted = service.open(workspaceRouteSessionOwner);
    evicted.session.changeText("must not submit");
    for (let index = 0; index < 4; index += 1) {
      vi.setSystemTime(index + 1);
      service.open(workspaceRouteSessionOwner);
    }

    vi.advanceTimersByTime(250);

    expect(service.get(evicted.id, workspaceRouteSessionOwner)).toBeNull();
    expect(evicted.session.request$.peek()).toBeNull();
  });
});

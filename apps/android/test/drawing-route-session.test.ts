import { afterEach, describe, expect, it, vi } from "vitest";

import { DrawingRouteSessionService } from "../src/services/drawing/drawingRouteSession";
import { disposeAllRouteSessions, ROUTE_SESSION_TTL_MS } from "../src/services/routeSessionPolicy";
import { workspaceRouteSessionOwner } from "../src/services/threads/threadRouteParams";

const drawingRequest = (commit: () => Promise<boolean>) => ({
  commit,
  editing: false,
  initialSnapshot: null,
  mode: "drawing" as const,
});

afterEach(() => {
  disposeAllRouteSessions();
  vi.useRealTimers();
});

describe("DrawingRouteSessionService", () => {
  it("reports capacity while every admitted slot is committing and recovers after close", async () => {
    const service = new DrawingRouteSessionService();
    const firstCommit = Promise.withResolvers<boolean>();
    const secondCommit = Promise.withResolvers<boolean>();
    const first = service.open(
      workspaceRouteSessionOwner,
      drawingRequest(() => firstCommit.promise),
    );
    const second = service.open(
      workspaceRouteSessionOwner,
      drawingRequest(() => secondCommit.promise),
    );
    if (first.status !== "admitted" || second.status !== "admitted") {
      throw new Error("Expected both drawing slots to be admitted");
    }
    const firstSettlement = service.commit(first.session.id, {
      pngDataUrl: "data:image/png;base64,first",
      snapshot: {},
    });
    const secondSettlement = service.commit(second.session.id, {
      pngDataUrl: "data:image/png;base64,second",
      snapshot: {},
    });

    expect(
      service.open(
        workspaceRouteSessionOwner,
        drawingRequest(async () => true),
      ),
    ).toEqual({
      status: "capacity",
    });
    service.close(first.session.id);
    const replacement = service.open(
      workspaceRouteSessionOwner,
      drawingRequest(async () => true),
    );
    expect(replacement.status).toBe("admitted");
    if (replacement.status !== "admitted") throw new Error("Expected restored admission");
    expect(service.get(replacement.session.id)).toBe(replacement.session);

    firstCommit.resolve(true);
    expect(await firstSettlement).toBe(false);
    expect(service.get(replacement.session.id)).toBe(replacement.session);
    secondCommit.resolve(false);
    expect(await secondSettlement).toBe(false);
    expect(
      service.open(
        workspaceRouteSessionOwner,
        drawingRequest(async () => true),
      ).status,
    ).toBe("admitted");
  });

  it("retires a never-settling commit at the deadline and rejects its late settlement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const service = new DrawingRouteSessionService();
    const pending = Promise.withResolvers<boolean>();
    const admitted = service.open(
      workspaceRouteSessionOwner,
      drawingRequest(() => pending.promise),
    );
    if (admitted.status !== "admitted") {
      throw new Error("Expected drawing admission");
    }
    const settlement = service.commit(admitted.session.id, {
      pngDataUrl: "data:image/png;base64,deadline",
      snapshot: {},
    });

    vi.advanceTimersByTime(ROUTE_SESSION_TTL_MS);

    expect(service.get(admitted.session.id)).toBeNull();
    pending.resolve(true);
    expect(await settlement).toBe(false);
  });
});

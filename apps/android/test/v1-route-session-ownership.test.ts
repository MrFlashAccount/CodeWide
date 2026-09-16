import { afterEach, describe, expect, it, vi } from "vitest";

import { composerToolRouteSessions } from "../src/services/composer/composerToolRouteSession";
import { disposeAllRouteSessions } from "../src/services/routeSessionPolicy";
import { terminalRouteSessions } from "../src/services/terminal/terminalRouteSession";
import {
  connectionIdParam,
  routeSessionIdParam,
  threadRouteSessionOwner,
  turnIdParam,
  v1ThreadRouteParams,
  type V1ThreadRouteParams,
} from "../src/services/threads/threadRouteParams";

function thread(connectionId: string, threadId: string): V1ThreadRouteParams {
  const parsed = v1ThreadRouteParams({ connectionId, threadId });
  if (parsed.status === "invalid") throw new Error("Expected valid test route parameters");
  return parsed.value;
}

afterEach(() => {
  disposeAllRouteSessions();
});

describe("V1 route-session ownership", () => {
  it("preserves opaque external identifiers while keeping local session ids strict", () => {
    const opaque = `${"x".repeat(1_100)}/segment\u0001`;
    expect(connectionIdParam(opaque)).toEqual({
      status: "valid",
      value: { kind: "connectionId", value: opaque },
    });
    expect(turnIdParam(opaque)).toEqual({
      status: "valid",
      value: { kind: "turnId", value: opaque },
    });
    expect(routeSessionIdParam(opaque)).toEqual({ status: "invalid" });
  });
  it("rejects a read session presented under another thread or connection", () => {
    const owner = threadRouteSessionOwner(thread("server-a", "thread-a"));
    const session = terminalRouteSessions.open(owner, {
      connectionId: "server-a",
      cwd: null,
      threadId: "thread-a",
    });

    expect(
      terminalRouteSessions.get(
        session.id,
        threadRouteSessionOwner(thread("server-a", "thread-b")),
      ),
    ).toBeNull();
    expect(
      terminalRouteSessions.get(
        session.id,
        threadRouteSessionOwner(thread("server-b", "thread-a")),
      ),
    ).toBeNull();
    expect(terminalRouteSessions.get(session.id, owner)?.request).toEqual({
      connectionId: "server-a",
      cwd: null,
      threadId: "thread-a",
    });
  });

  it("does not expose a captured action callback to a mismatched parent", async () => {
    const startReview = vi.fn(async () => "review");
    const owner = threadRouteSessionOwner(thread("server-a", "thread-a"));
    const session = composerToolRouteSessions.open(owner, { kind: "review", startReview });
    const mismatched = composerToolRouteSessions.get(
      session.id,
      threadRouteSessionOwner(thread("server-a", "thread-b")),
    );

    expect(mismatched).toBeNull();
    expect(startReview).not.toHaveBeenCalled();
    const matching = composerToolRouteSessions.get(session.id, owner);
    if (matching?.request.kind !== "review") throw new Error("Expected matching review session");
    await matching.request.startReview?.({ type: "uncommittedChanges" }, { type: "inline" });
    expect(startReview).toHaveBeenCalledTimes(1);
  });
});

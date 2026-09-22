import { describe, expect, it } from "vitest";

import {
  parseThreadSelectionKey,
  threadSelectionKey,
  v1ThreadDestination,
  v1ThreadRouteParams,
} from "../src/services/threads/threadRouteParams";

describe("V1 thread route identity", () => {
  it("round-trips opaque qualified selections into the canonical route", () => {
    const parsed = parseThreadSelectionKey(
      threadSelectionKey({ serverId: "server/path\u0000one", id: "thread/path\u0000two" }),
    );
    expect(parsed).toEqual({
      connectionId: { kind: "connectionId", value: "server/path\u0000one" },
      threadId: { kind: "threadId", value: "thread/path\u0000two" },
    });
    if (parsed === null) throw new Error("Expected a qualified thread");
    expect(v1ThreadDestination(parsed)).toEqual({
      pathname: "/threads/[connectionId]/[threadId]",
      params: { connectionId: "server/path\u0000one", threadId: "thread/path\u0000two" },
    });
  });

  it("rejects incomplete and repeated route parameters without restricting opaque IDs", () => {
    expect(v1ThreadRouteParams({ connectionId: "server" })).toEqual({ status: "invalid" });
    expect(v1ThreadRouteParams({ connectionId: ["server"], threadId: "thread" })).toEqual({
      status: "invalid",
    });
    expect(v1ThreadRouteParams({ connectionId: "server/path", threadId: "thread\u0001" })).toEqual({
      status: "valid",
      value: {
        connectionId: { kind: "connectionId", value: "server/path" },
        threadId: { kind: "threadId", value: "thread\u0001" },
      },
    });
  });

  it("does not decode malformed or empty internal selection keys", () => {
    expect(parseThreadSelectionKey(null)).toBeNull();
    expect(parseThreadSelectionKey("server")).toBeNull();
    expect(parseThreadSelectionKey("\u0000thread")).toBeNull();
    expect(parseThreadSelectionKey("0:thread")).toBeNull();
    expect(parseThreadSelectionKey("6:server")).toBeNull();
    expect(parseThreadSelectionKey("99:serverthread")).toBeNull();
  });
});

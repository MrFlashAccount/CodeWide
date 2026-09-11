import { describe, expect, it } from "vitest";

import { ThreadHistoryReadAuthority } from "../src/data/thread-history-read-authority";

describe("history read authority", () => {
  it("rejects a completed old read after reconnect without disturbing another server", async () => {
    const authority = new ThreadHistoryReadAuthority();
    const oldRead = authority.capture("server");
    const otherServer = authority.capture("other");
    const response = await Promise.resolve(["turn-2"]);
    authority.invalidate("server");
    const newRead = authority.capture("server");
    const persisted = oldRead() ? response : [];
    expect(persisted).toEqual([]);
    expect(oldRead()).toBe(false);
    expect(newRead()).toBe(true);
    expect(otherServer()).toBe(true);
  });

  it("does not revive an old lease after repeated authority changes", () => {
    const authority = new ThreadHistoryReadAuthority();
    const first = authority.capture("server");
    authority.invalidate("server");
    const second = authority.capture("server");
    authority.invalidate("server");
    expect(first()).toBe(false);
    expect(second()).toBe(false);
    expect(authority.capture("server")()).toBe(true);
  });
});

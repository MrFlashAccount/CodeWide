import { RpcResponseError } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { readThreadHistoryPage } from "../src/data/thread-history-page-read";
import { ThreadHistoryReadAuthority } from "../src/data/thread-history-read-authority";

describe("history page recovery", () => {
  it("repairs an invalidated source once without treating it as exhaustion", async () => {
    const repair = vi.fn(async () => undefined);
    const read = vi.fn(async () => { throw new RpcResponseError(-32021, "History source changed"); });
    expect(await readThreadHistoryPage({ read, repair, isCurrent: () => true }))
      .toEqual({ status: "superseded" });
    expect(read).toHaveBeenCalledOnce();
    expect(repair).toHaveBeenCalledOnce();
  });

  it("preserves an offline failure so the next intent can retry", async () => {
    const offline = new Error("offline");
    const repair = vi.fn(async () => undefined);
    await expect(readThreadHistoryPage({
      read: async () => { throw offline; }, repair, isCurrent: () => true,
    })).rejects.toBe(offline);
    expect(repair).not.toHaveBeenCalled();
    const page = { turns: [], hasMore: false, sourceWitness: "current" };
    expect(await readThreadHistoryPage({ read: async () => page, repair, isCurrent: () => true }))
      .toEqual({ status: "page", page });
  });

  it("discards a successful response from replaced authority", async () => {
    const authority = new ThreadHistoryReadAuthority();
    const isCurrent = authority.capture("server");
    const repair = vi.fn(async () => undefined);
    const result = await readThreadHistoryPage({
      isCurrent, repair,
      async read() {
        authority.invalidate("server");
        return { turns: [], hasMore: false, sourceWitness: "obsolete" };
      },
    });
    expect(result).toEqual({ status: "superseded" });
    expect(repair).not.toHaveBeenCalled();
  });

  it("does not hide failure of the authoritative repair", async () => {
    const failure = new Error("repair failed");
    await expect(readThreadHistoryPage({
      isCurrent: () => true,
      read: async () => { throw new RpcResponseError(-32021, "expired anchor"); },
      repair: async () => { throw failure; },
    })).rejects.toBe(failure);
  });
});

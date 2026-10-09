import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";
import { createThreadSummaryMetadataReader } from "../src/data/threadSummaryMetadata";
import { createV1TestThread } from "./fixtures/v1Thread";

function session(rpc: (method: string, params: unknown) => Promise<unknown>): RpcClient {
  // WHY: The transport selects its generic result at the caller. This fixture
  // returns raw unknown responses to exercise the production runtime adapter.
  return { rpc } as RpcClient;
}

describe("targeted summary metadata", () => {
  it("reads an old chat without scanning recent pages or resuming its execution", async () => {
    const thread = createV1TestThread("old-thread", null, 1, []);
    const rpc = vi.fn(async () => ({ thread }));
    const client = session(rpc);
    const read = createThreadSummaryMetadataReader(() => client);
    expect(await read("server", "old-thread")).toEqual({ archived: false, thread });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("thread/read", {
      includeTurns: false,
      threadId: "old-thread",
    });
  });

  it("rejects another chat's metadata instead of seeding a wrong row", async () => {
    const client = session(async () => ({ thread: createV1TestThread("other", null, 1, []) }));
    await expect(
      createThreadSummaryMetadataReader(() => client)("server", "requested"),
    ).rejects.toThrow("invalid summary metadata");
  });

  it("rejects malformed metadata and an unavailable connection", async () => {
    const client = session(async () => ({ thread: { id: "thread" } }));
    await expect(
      createThreadSummaryMetadataReader(() => client)("server", "thread"),
    ).rejects.toThrow("invalid summary metadata");
    await expect(
      createThreadSummaryMetadataReader(() => undefined)("server", "thread"),
    ).rejects.toThrow("active connection");
  });

  it("rejects a response from a replaced connection", async () => {
    const response = Promise.withResolvers<unknown>();
    const original = session(() => response.promise);
    let current = original;
    const reading = createThreadSummaryMetadataReader(() => current)("server", "thread");
    current = session(async () => ({}));
    response.resolve({ thread: createV1TestThread("thread", null, 1, []) });
    await expect(reading).rejects.toThrow("superseded");
  });
});

import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it } from "vitest";
import {
  createThreadResourceLoader,
  type ThreadResourceAuthority,
} from "../src/data/thread-resource-loader";
import type { ThreadResourcesRow } from "../src/data/thread-resource-types";

const session: RpcClient = {
  rpc: async () => {
    throw new Error("must use qualified transport");
  },
};
function harness(respond: (method: string) => Promise<unknown>) {
  const rows = new Map<string, ThreadResourcesRow>();
  const resources: ReturnType<ThreadResourceAuthority["getResources"]> = {
    threadResources: { get: (id) => rows.get(id) },
    putThreadResources: (row) => rows.set(row.id, { ...row, updatedAt: 1 }),
  };
  const loader = createThreadResourceLoader({
    getResources: () => resources,
    getSession: () => session,
    readRecencyAt: async () => null,
    rpcAfterAttach: async (_session, method) => await respond(method),
  });
  return { loader, rows };
}

describe("V1 shared thread resource loader", () => {
  it("deduplicates matching requests and waits for an overlapping full read", async () => {
    const response = Promise.withResolvers<unknown>();
    const calls: string[] = [];
    const { loader } = harness(async (method) => {
      calls.push(method);
      return await response.promise;
    });
    const first = loader.loadThreadResources("server", "thread");
    const duplicate = loader.loadThreadResources("server", "thread");
    const changes = loader.loadThreadResources("server", "thread", undefined, "changes");
    await Promise.resolve();
    expect(calls).toEqual(["companion/threadResources/read"]);
    response.resolve({ threadId: "thread", revision: "r1", changes: [], attachments: [] });
    const value = await first;
    expect(await duplicate).toBe(value);
    expect(await changes).toBe(value);
    expect(calls).toHaveLength(1);
  });

  it("publishes a scoped error and releases the failed operation for retry", async () => {
    let calls = 0;
    const failure = new Error("resource unavailable");
    const { loader, rows } = harness(async () => {
      if (++calls === 1) throw failure;
      return { threadId: "thread", revision: "recovered", changes: [] };
    });
    await expect(loader.loadThreadResources("server", "thread", undefined, "changes")).rejects.toBe(
      failure,
    );
    const failed = rows.values().next().value;
    expect(failed?.status).toBe("error");
    expect(failed?.resourceErrors).toEqual({ changes: "resource unavailable" });
    const recovered = await loader.loadThreadResources("server", "thread", undefined, "changes");
    expect(recovered.revision).toBe("recovered");
    const ready = rows.values().next().value;
    expect(ready?.status).toBe("ready");
    expect(ready?.resourceErrors).toEqual({});
    expect(ready?.readyKinds).toEqual(["changes"]);
  });
});

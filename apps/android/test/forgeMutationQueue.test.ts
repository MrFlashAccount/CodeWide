import { onlineManager, QueryClient } from "@tanstack/react-query";
import type { RpcClient } from "@codewide/sync-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createForgeMutationEnvelope,
  type ForgeMutationEnvelope,
} from "../src/data/forgeMutationEnvelope";
import {
  createForgeMutationQueue,
  registerForgeMutationDefaults,
} from "../src/data/forgeMutationQueue";
import { persistForgeQueryClient } from "../src/data/forgeQueryPersistence";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

function request(): ForgeMutationEnvelope {
  return createForgeMutationEnvelope({
    connectionId: "server",
    method: "companion/pullRequest/links/set",
    operationId: "operation-1",
    params: { linked: true, pullRequest: "fpr1.one", threadId: "thread-1" },
    scope: "server:pull-request:fpr1.one",
  });
}

function rpcAuthority(rpc: RpcClient["rpc"]) {
  const session: RpcClient = { rpc };
  return {
    getSession: () => session,
    rpcAfterAttach: async <Result>(current: RpcClient, method: string, params: unknown) =>
      current.rpc<Result>(method, params),
  };
}

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("durable Forge mutation queue", () => {
  it("uses TanStack's paused mutation lifecycle while the device is offline", async () => {
    const client = new QueryClient();
    client.mount();
    const rpc = vi.fn(async () => ({ ok: true }));
    registerForgeMutationDefaults({ authority: rpcAuthority(rpc), client });
    const persistence = persistForgeQueryClient(client, createMemoryQueryPersister().persister);
    await persistence.restored;
    const queue = createForgeMutationQueue({ client, restored: persistence.restored });
    onlineManager.setOnline(false);

    const result = queue.execute(request(), (value) => value);
    await vi.waitFor(() => {
      expect(queue.pending()).toHaveLength(1);
    });
    expect(rpc).not.toHaveBeenCalled();

    onlineManager.setOnline(true);

    await expect(result).resolves.toStrictEqual({ ok: true });
    persistence.stop();
    client.unmount();
  });

  it("restores a paused mutation and replays its exact envelope", async () => {
    const memory = createMemoryQueryPersister();
    const firstClient = new QueryClient();
    firstClient.mount();
    const firstRpc = vi.fn(async () => ({ ok: true }));
    registerForgeMutationDefaults({ authority: rpcAuthority(firstRpc), client: firstClient });
    const firstPersistence = persistForgeQueryClient(firstClient, memory.persister);
    await firstPersistence.restored;
    const firstQueue = createForgeMutationQueue({
      client: firstClient,
      restored: firstPersistence.restored,
    });
    onlineManager.setOnline(false);
    const original = request();
    void firstQueue.execute(original, (value) => value);
    await vi.waitFor(() => {
      expect(memory.read()).not.toBeNull();
    });
    firstPersistence.stop();

    const restartedClient = new QueryClient();
    restartedClient.mount();
    const restartedRpc = vi.fn(async () => ({ ok: true }));
    registerForgeMutationDefaults({
      authority: rpcAuthority(restartedRpc),
      client: restartedClient,
    });
    const restartedPersistence = persistForgeQueryClient(restartedClient, memory.persister);
    const restartedQueue = createForgeMutationQueue({
      client: restartedClient,
      restored: restartedPersistence.restored,
    });
    await restartedPersistence.restored;
    expect(restartedQueue.pending()).toStrictEqual([original]);

    onlineManager.setOnline(true);

    await vi.waitFor(() => {
      expect(restartedRpc).toHaveBeenCalledWith(original.method, original.params);
    });
    restartedPersistence.stop();
    firstClient.unmount();
    restartedClient.unmount();
  });
});

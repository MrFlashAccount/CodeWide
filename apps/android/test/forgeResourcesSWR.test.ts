import { describe, expect, it, vi } from "vitest";

import { createForgeResources } from "../src/data/forgeResources";
import { reviewRequestedPage } from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

function createResources(persister: ReturnType<typeof createMemoryQueryPersister>["persister"]) {
  return createForgeResources({
    getSession: () => undefined,
    persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach: async <Result>(): Promise<Result> => {
      throw new Error("Unexpected live read");
    },
  });
}

describe("forge persisted stale-while-revalidate", () => {
  it("restores TanStack query data before live revalidation", async () => {
    const memory = createMemoryQueryPersister();
    const first = createResources(memory.persister);
    await first.restored;
    first.lists.publish(
      { category: "reviewRequested", connectionId: "server", repository: null },
      reviewRequestedPage,
    );
    await vi.waitFor(() => {
      expect(memory.read()).not.toBeNull();
    });

    const restarted = createResources(memory.persister);
    await restarted.restored;

    expect(
      restarted.lists.data({
        category: "reviewRequested",
        connectionId: "server",
        repository: null,
      }),
    ).toMatchObject({ category: "reviewRequested" });
  });
});

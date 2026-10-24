import { describe, expect, it, vi } from "vitest";
import type { RpcClient } from "@codewide/sync-client";

import { createForgeResources } from "../src/data/forgeResources";
import { defaultPullRequestFilter } from "../src/features/pullRequests/pullRequestListModel";
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
      { connectionId: "server", filter: defaultPullRequestFilter() },
      reviewRequestedPage,
    );
    await vi.waitFor(() => {
      expect(memory.read()).not.toBeNull();
    });

    const restarted = createResources(memory.persister);
    await restarted.restored;

    expect(
      restarted.lists.data({
        connectionId: "server",
        filter: defaultPullRequestFilter(),
      }),
    ).toMatchObject({ category: "reviewRequested" });
  });

  it("discards persisted list rows from the previous cache schema", async () => {
    const memory = createMemoryQueryPersister();
    const first = createResources(memory.persister);
    await first.restored;
    const params = {
      connectionId: "server",
      filter: defaultPullRequestFilter(),
    };
    first.queryClient.setQueryData(first.lists.keyOf(params), {
      ...reviewRequestedPage,
      sections: reviewRequestedPage.sections.map((section) => ({
        ...section,
        rows: section.rows.map(({ attention: _attention, ...row }) => row),
      })),
    });
    await vi.waitFor(() => {
      expect(memory.read()).toContain('"buster":"forge-query-cache-v2"');
    });
    const persisted = memory.read();
    if (persisted === null) {
      throw new Error("The Forge query fixture was not persisted");
    }
    memory.overwrite(
      persisted.replace('"buster":"forge-query-cache-v2"', '"buster":"forge-query-cache-v1"'),
    );

    const restarted = createResources(memory.persister);
    await restarted.restored;

    expect(restarted.lists.data(params)).toBeNull();
  });

  it("sends the complete selected filter to the search RPC", async () => {
    const calls: { readonly method: string; readonly params: unknown }[] = [];
    const session: RpcClient = {
      connectionId: "server",
      rpc: async <Result>(): Promise<Result> => Promise.reject(new Error("Unexpected direct RPC")),
    };
    const resources = createForgeResources({
      getSession: () => session,
      persister: createMemoryQueryPersister().persister,
      reportDroppedAction: () => undefined,
      rpcAfterAttach: async <Result>(_session, method, params): Promise<Result> => {
        calls.push({ method, params });
        // WHY: this transport fixture returns the wire-contract page consumed by the production parser.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return reviewRequestedPage as Result;
      },
    });
    await resources.restored;
    const base = defaultPullRequestFilter();
    const filter = {
      ...base,
      query: {
        ...base.query,
        states: { exclude: [], include: ["merged"] as const },
      },
    };

    await resources.lists.refresh({ connectionId: "server", filter });

    expect(calls).toStrictEqual([
      {
        method: "companion/pullRequests/search",
        params: {
          accounts: [],
          cursor: null,
          providerIds: [],
          query: filter.query,
        },
      },
    ]);
  });
});

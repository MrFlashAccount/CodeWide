import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandCapabilities } from "../src/v2/application/commandCapabilities";
import type { CommandCorrelation } from "../src/v2/application/commandCorrelation";
import { CommandCorrelationResource } from "../src/v2/application/resources/commandCorrelationResource";
import { savedServerId } from "../src/v2/domain/ids";

const scope = {
  savedServerId: savedServerId("saved-server-a"),
  surface: "newThread",
  threadId: null,
} as const;

const durable: CommandCorrelation = {
  ...scope,
  correlationId: "correlation-a",
  operationId: "operation-a",
  state: "durable",
  createdAtMs: 1,
  updatedAtMs: 2,
};

afterEach(() => vi.useRealTimers());

describe("V2 command correlation resource", () => {
  it("loads the local durable lock before opening the live subscription", async () => {
    const order: string[] = [];
    const resource = new CommandCorrelationResource(
      capabilities({
        listUnsettled: async () => {
          order.push("local-refresh");
          return [durable];
        },
        subscribe: async () => {
          order.push("live-subscribe");
          return () => undefined;
        },
      }),
      scope,
    );

    const unsubscribe = resource.subscribe(() => undefined);
    await vi.waitFor(() => expect(resource.snapshot().status).toBe("ready"));

    expect(order.slice(0, 2)).toEqual(["local-refresh", "live-subscribe"]);
    expect(resource.snapshot().value).toEqual([durable]);
    expect(resource.isLocked(durable.correlationId, durable.operationId)).toBe(true);
    unsubscribe();
  });

  it("keeps a returned durable lock through refresh failure and empty-list absence", async () => {
    let refresh = 0;
    const resource = new CommandCorrelationResource(
      capabilities({
        listUnsettled: async () => {
          refresh += 1;
          if (refresh === 1) throw new Error("private sqlite detail");
          return [];
        },
      }),
      scope,
    );

    resource.retainLock(durableUnsettled());
    await vi.waitFor(() => expect(resource.snapshot().status).toBe("error"));
    expect(resource.snapshot()).toMatchObject({
      message: "Could not read saved command status",
      status: "error",
    });
    expect(resource.isLocked(durable.correlationId)).toBe(true);

    await resource.refresh();
    expect(resource.snapshot()).toEqual({ status: "ready", value: [] });
    expect(resource.isLocked(durable.correlationId, durable.operationId)).toBe(true);
  });

  it("keeps bounded subscription backoff alive through a longer outage", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const subscribe = vi.fn(async () => {
      attempts += 1;
      if (attempts < 6) throw new Error("private transport detail");
      return () => undefined;
    });
    const resource = new CommandCorrelationResource(
      capabilities({ listUnsettled: async () => [durable], subscribe }),
      scope,
    );

    const unsubscribe = resource.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(subscribe).toHaveBeenCalledTimes(6);
    await vi.waitFor(() => expect(resource.snapshot().status).toBe("ready"));
    expect(resource.snapshot().value).toEqual([durable]);
    unsubscribe();
  });

  it("prevents an older overlapping refresh from publishing after a newer read", async () => {
    const first = deferred<CommandCorrelation[]>();
    const second = deferred<CommandCorrelation[]>();
    let read = 0;
    const resource = new CommandCorrelationResource(
      capabilities({
        listUnsettled: () => {
          read += 1;
          return read === 1 ? first.promise : second.promise;
        },
      }),
      scope,
    );

    const older = resource.refresh();
    const newer = resource.refresh();
    second.resolve([durable]);
    await newer;
    first.resolve([]);
    await older;

    expect(resource.snapshot()).toEqual({ status: "ready", value: [durable] });
  });

  it("orders retained-lock acquisition after an in-flight stale refresh", async () => {
    const first = deferred<CommandCorrelation[]>();
    const second = deferred<CommandCorrelation[]>();
    let read = 0;
    const resource = new CommandCorrelationResource(
      capabilities({
        listUnsettled: () => {
          read += 1;
          return read === 1 ? first.promise : second.promise;
        },
        reconcile: async () => durableUnsettled(),
      }),
      scope,
    );

    const stale = resource.refresh();
    resource.retainLock(durableUnsettled());
    first.resolve([]);
    await stale;
    expect(resource.isLocked(durable.correlationId, durable.operationId)).toBe(true);

    second.resolve([durable]);
    await vi.waitFor(() => expect(resource.snapshot().status).toBe("ready"));
    expect(resource.pendingCount()).toBe(1);
  });

  it("unlocks only from typed settlement for the exact retained operation", async () => {
    let settlement: ReturnType<typeof durableUnsettled> | ReturnType<typeof completed> =
      completed("operation-other");
    const resource = new CommandCorrelationResource(
      capabilities({
        listUnsettled: async () => [],
        reconcile: async () => settlement,
      }),
      scope,
    );
    resource.retainLock(durableUnsettled());
    await resource.refresh();
    expect(resource.isLocked(durable.correlationId, durable.operationId)).toBe(true);

    settlement = completed(durable.operationId);
    await resource.refresh();
    expect(resource.isLocked(durable.correlationId, durable.operationId)).toBe(false);
    expect(resource.settlement(durable.correlationId, durable.operationId)).toMatchObject({
      kind: "terminal",
      operationId: durable.operationId,
    });
  });
});

function capabilities(overrides: {
  listUnsettled(): Promise<CommandCorrelation[]>;
  reconcile?(
    correlationId: string,
  ): Promise<ReturnType<typeof durableUnsettled> | ReturnType<typeof completed> | null>;
  subscribe?(savedServerId: string, listener: () => void): Promise<() => void>;
}): CommandCapabilities {
  return {
    listLocalUnsettled: overrides.listUnsettled,
    listUnsettled: overrides.listUnsettled,
    reconcile: overrides.reconcile ?? (async () => null),
    subscribe:
      overrides.subscribe ??
      (async () => {
        return () => undefined;
      }),
  } as CommandCapabilities;
}

function durableUnsettled() {
  return {
    correlationId: durable.correlationId,
    failure: { code: "durableUnsettled" as const, message: "Saved", retryable: false as const },
    kind: "durableUnsettled" as const,
    operationId: durable.operationId,
  };
}

function completed(operationId: string) {
  return {
    correlationId: durable.correlationId,
    frame: {
      operationId,
      result: { kind: "turn.submit" as const, threadId: "thread-a", turnId: "turn-a" },
      type: "commandCompleted" as const,
    },
    kind: "terminal" as const,
    operationId,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

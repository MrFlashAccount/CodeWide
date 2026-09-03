import { describe, expect, it } from "vitest";
import {
  SyncV2CommandDurableUnsettledError,
  SyncV2CommandNotCreatedError,
  type V2Command,
  type V2CommandTerminalFrame,
  type V2OperationReceipt,
  type V2OperationStatus,
  type V2Query,
  type V2QueryResult,
} from "@codewide/sync-client/v2";

import { CommandCapabilities } from "../src/v2/application/commandCapabilities";
import { CommandCorrelationScopeBlockedError } from "../src/v2/application/commandCorrelation";
import { savedServerId } from "../src/v2/domain/ids";
import { createCommandCorrelationStore } from "../src/v2/infrastructure/persistence/sqliteCommandCorrelationStore.web";

const server = savedServerId("saved-server-a");
const command: V2Command = {
  input: [{ kind: "text", text: "same text" }],
  intent: "chat",
  kind: "turn.submit",
  settings: null,
  threadId: "thread-a",
  workspace: null,
};
const scope = { savedServerId: server, surface: "threadComposer", threadId: "thread-a" } as const;

describe("V2 command correlation", () => {
  it("keeps the draft retryable only when no operation was created", async () => {
    const fixture = setup(async (operationId) => {
      throw new SyncV2CommandNotCreatedError(operationId);
    });

    await expect(fixture.capabilities.executeCorrelated(scope, command)).resolves.toMatchObject({
      kind: "notCreated",
      failure: { retryable: true },
    });
    expect(await fixture.correlations.listUnsettled(scope)).toEqual([]);
  });

  it("retains one content-free correlation for a durable unsettled command", async () => {
    const fixture = setup(async (operationId) => {
      fixture.operations.push(status(operationId, "sent"));
      throw new SyncV2CommandDurableUnsettledError(operationId);
    });

    const settlement = await fixture.capabilities.executeCorrelated(scope, command);
    expect(settlement).toMatchObject({
      kind: "durableUnsettled",
      failure: { retryable: false },
    });
    const records = await fixture.capabilities.listUnsettled(scope);
    expect(records).toEqual([
      expect.objectContaining({
        correlationId: settlement.correlationId,
        operationId: settlement.operationId,
        state: "durable",
      }),
    ]);
    expect(records[0]).not.toHaveProperty("command");
    expect(records[0]).not.toHaveProperty("text");
  });

  it("does not fingerprint equal explicit activations into one operation", async () => {
    const fixture = setup(async (operationId) => ({
      operationId,
      result: { kind: "turn.submit", threadId: "thread-a", turnId: operationId },
      type: "commandCompleted",
    }));

    const first = await fixture.capabilities.executeCorrelated(scope, command);
    const second = await fixture.capabilities.executeCorrelated(scope, command);
    expect(first.operationId).not.toBe(second.operationId);
    expect(first.correlationId).not.toBe(second.correlationId);
  });

  it("keeps a crashed allocation durable when remount cannot prove pre-create failure", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    await fixture.correlations.begin({
      ...scope,
      correlationId: "correlation-orphan",
      operationId: "operation-orphan",
      state: "allocating",
      createdAtMs: 1,
      updatedAtMs: 1,
    });

    expect(await fixture.capabilities.listUnsettled(scope)).toEqual([
      expect.objectContaining({ operationId: "operation-orphan", state: "durable" }),
    ]);
    expect(await fixture.correlations.get("correlation-orphan")).toMatchObject({
      state: "durable",
    });
  });

  it("keeps the same operation durable after a crash immediately after create", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    await beginCrashRecord(fixture, "after-create", "allocating");
    fixture.operations.push(status("operation-after-create", "created"));

    expect(await fixture.capabilities.listUnsettled(scope)).toEqual([
      expect.objectContaining({ operationId: "operation-after-create", state: "durable" }),
    ]);
    expect(await fixture.correlations.get("correlation-after-create")).toMatchObject({
      state: "durable",
    });
  });

  it("keeps an admitted same-id operation pending after process recreation", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    await beginCrashRecord(fixture, "after-accepted", "durable");
    fixture.operations.push(status("operation-after-accepted", "accepted"));
    fixture.receipts.set("operation-after-accepted", {
      acceptedAt: "2026-08-30T20:00:00Z",
      state: "admitted",
    });

    expect(await fixture.capabilities.listUnsettled(scope)).toEqual([
      expect.objectContaining({ operationId: "operation-after-accepted", state: "durable" }),
    ]);
  });

  it("persists an explicit duplicate-risk decision without forgetting the old operation", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    await beginCrashRecord(fixture, "released", "durable");

    await fixture.capabilities.releaseUnsettled("correlation-released");
    await fixture.correlations.markDurable("correlation-released", 3);

    expect(await fixture.correlations.get("correlation-released")).toMatchObject({
      operationId: "operation-released",
      state: "durableReleased",
    });
    expect(await fixture.capabilities.listLocalUnsettled(scope)).toEqual([
      expect.objectContaining({
        operationId: "operation-released",
        state: "durableReleased",
      }),
    ]);
  });

  it.each(["completed", "failed", "indeterminate", "rejected", "expired"] as const)(
    "settles a correlation from a persisted %s terminal state after process death",
    async (terminalClass) => {
      const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
      await beginCrashRecord(fixture, `after-${terminalClass}`, "durable");
      fixture.operations.push(status(`operation-after-${terminalClass}`, terminalClass));
      fixture.receipts.set(
        `operation-after-${terminalClass}`,
        receiptFor(terminalClass, `operation-after-${terminalClass}`),
      );

      expect(await fixture.capabilities.listUnsettled(scope)).toEqual([]);
      expect(await fixture.correlations.get(`correlation-after-${terminalClass}`)).toMatchObject({
        state:
          terminalClass === "completed"
            ? "completed"
            : terminalClass === "indeterminate"
              ? "indeterminate"
              : "failed",
      });
    },
  );

  it("settles an accepted operation from its authoritative expired receipt", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    await beginCrashRecord(fixture, "expired-receipt", "durable");
    fixture.operations.push(status("operation-expired-receipt", "accepted"));
    fixture.receipts.set("operation-expired-receipt", {
      acceptedAt: "2026-08-30T20:00:00Z",
      state: "expired",
      terminal: "failed",
    });

    await expect(
      fixture.capabilities.reconcile("correlation-expired-receipt"),
    ).resolves.toMatchObject({
      kind: "terminal",
      frame: { type: "commandExpired", operationId: "operation-expired-receipt" },
    });
    expect(await fixture.correlations.get("correlation-expired-receipt")).toMatchObject({
      state: "failed",
    });
  });

  it("never converts pruned durable work into retryable notCreated", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined), {
      now: 31 * 24 * 60 * 60 * 1_000,
    });
    await beginCrashRecord(fixture, "pruned", "durable", 0);

    expect(await fixture.capabilities.listUnsettled(scope)).toEqual([
      expect.objectContaining({ operationId: "operation-pruned", state: "durable" }),
    ]);
    expect(await fixture.correlations.get("correlation-pruned")).toMatchObject({
      state: "durable",
    });
  });

  it("keeps terminal status durable until an exact authoritative receipt is available", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    await beginCrashRecord(fixture, "terminal-without-receipt", "durable");
    fixture.operations.push(status("operation-terminal-without-receipt", "completed"));

    expect(await fixture.capabilities.listUnsettled(scope)).toEqual([
      expect.objectContaining({
        operationId: "operation-terminal-without-receipt",
        state: "durable",
      }),
    ]);
    await expect(
      fixture.capabilities.reconcile("correlation-terminal-without-receipt"),
    ).resolves.toMatchObject({ kind: "durableUnsettled" });
  });

  it("does not settle a command from a terminal frame for another operation", async () => {
    const fixture = setup(async () => ({
      operationId: "operation-other",
      result: { kind: "turn.submit", threadId: "thread-a", turnId: "turn-other" },
      type: "commandCompleted",
    }));

    await expect(fixture.capabilities.executeCorrelated(scope, command)).resolves.toMatchObject({
      kind: "durableUnsettled",
      operationId: "operation-1",
    });
    expect(await fixture.correlations.get("correlation-1")).toMatchObject({ state: "durable" });
  });

  it("treats an ambiguous command/store failure as non-retryable", async () => {
    const fixture = setup(async () => {
      throw new Error("internal database detail");
    });

    await expect(fixture.capabilities.executeCorrelated(scope, command)).resolves.toMatchObject({
      kind: "durableUnsettled",
      failure: { retryable: false },
    });
  });

  it("returns a bounded notCreated outcome when correlation begin or session open fails", async () => {
    const beginFailure = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    beginFailure.correlations.begin = async () => {
      throw new Error("raw begin detail");
    };
    await expect(
      beginFailure.capabilities.executeCorrelated(scope, command),
    ).resolves.toMatchObject({
      kind: "notCreated",
      failure: { retryable: true },
    });

    const openFailure = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined), {
      openFails: true,
    });
    await expect(openFailure.capabilities.executeCorrelated(scope, command)).resolves.toMatchObject(
      {
        kind: "notCreated",
        failure: { retryable: true },
      },
    );
  });

  it("keeps a quarantined correlation scope non-retryable", async () => {
    const fixture = setup(async () => new Promise<V2CommandTerminalFrame>(() => undefined));
    fixture.correlations.begin = async () => {
      throw new CommandCorrelationScopeBlockedError();
    };

    await expect(fixture.capabilities.executeCorrelated(scope, command)).resolves.toMatchObject({
      kind: "durableUnsettled",
      failure: { retryable: false },
    });
  });
});

function setup(
  execute: (operationId: string, command: V2Command) => Promise<V2CommandTerminalFrame>,
  options: { now?: number; openFails?: boolean } = {},
) {
  const operations: V2OperationStatus[] = [];
  const receipts = new Map<string, V2OperationReceipt>();
  const correlations = createCommandCorrelationStore();
  let id = 0;
  const session = {
    command: execute,
    operations: async () => operations,
    query: async (query: V2Query): Promise<V2QueryResult> => {
      if (query.kind !== "operation.get") throw new Error("query not expected");
      const receipt = receipts.get(query.operationId);
      if (receipt === undefined) throw new Error("receipt not expected");
      return { kind: "operation.get", operationId: query.operationId, receipt };
    },
    state: "live",
    subscribe: (_listener: () => void) => () => undefined,
  };
  const capabilities = new CommandCapabilities({
    correlationId: () => `correlation-${++id}`,
    correlations,
    now: () => options.now ?? id,
    operationId: () => `operation-${id}`,
    sessions: {
      open: async () => {
        if (options.openFails === true) throw new Error("raw open detail");
        return { session };
      },
    },
  });
  return { capabilities, correlations, operations, receipts };
}

function status(operationId: string, state: V2OperationStatus["state"]): V2OperationStatus {
  return {
    acceptedAt: null,
    commandKind: "turn.submit",
    createdAtMs: 1,
    operationId,
    state,
    terminalClass: ["created", "sent", "accepted"].includes(state)
      ? null
      : (state as NonNullable<V2OperationStatus["terminalClass"]>),
    updatedAtMs: 1,
  };
}

function receiptFor(
  terminalClass: "completed" | "failed" | "indeterminate" | "rejected" | "expired",
  operationId: string,
): V2OperationReceipt {
  const acceptedAt = "2026-08-30T20:00:00Z";
  if (terminalClass === "completed") {
    return {
      acceptedAt,
      result: { kind: "turn.submit", threadId: "thread-a", turnId: operationId },
      state: "completed",
    };
  }
  if (terminalClass === "indeterminate") {
    return {
      acceptedAt,
      error: { code: "operationIndeterminate", message: "Unknown", recovery: "requery" },
      state: "indeterminate",
    };
  }
  if (terminalClass === "expired") {
    return { acceptedAt, state: "expired", terminal: "failed" };
  }
  return {
    acceptedAt,
    error: { code: "conflict", message: "Rejected", recovery: "requery" },
    state: "failed",
  };
}

async function beginCrashRecord(
  fixture: ReturnType<typeof setup>,
  suffix: string,
  state: "allocating" | "durable",
  createdAtMs = 1,
): Promise<void> {
  await fixture.correlations.begin({
    ...scope,
    correlationId: `correlation-${suffix}`,
    operationId: `operation-${suffix}`,
    state,
    createdAtMs,
    updatedAtMs: createdAtMs,
  });
}

import {
  SyncV2CommandDurableUnsettledError,
  type V2Command,
  type V2CommandTerminalFrame,
  type V2OperationStatus,
  type V2Query,
  type V2QueryResult,
} from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import {
  CommandActivationError,
  CommandActivationOwner,
  CommandActivationRecoveredError,
} from "../src/v2/application/commandActivationOwner";
import { CommandCapabilities } from "../src/v2/application/commandCapabilities";
import { savedServerId } from "../src/v2/domain/ids";
import { createCommandCorrelationStore } from "../src/v2/infrastructure/persistence/sqliteCommandCorrelationStore.web";

const server = savedServerId("activation-server");

describe("V2 command activation owner", () => {
  it.each(ambiguousCommandCases())(
    "recovers one ambiguous $name activation without allocating another operation",
    async (testCase) => {
      const fixture = setup();

      await expect(fixture.owner.execute(server, testCase.first)).rejects.toMatchObject({
        operationId: "operation-1",
        retryable: false,
      });
      await expect(fixture.owner.execute(server, testCase.second)).rejects.toMatchObject({
        operationId: "operation-1",
        retryable: false,
      });

      expect(fixture.calls).toEqual([{ command: testCase.first, operationId: "operation-1" }]);
      const records = await fixture.correlations.listUnsettled(
        fixture.owner.scope(server, testCase.first),
      );
      expect(records).toHaveLength(1);
      expect(records[0]).not.toHaveProperty("command");
      expect(records[0]).not.toHaveProperty("payload");
      expect(records[0]).not.toHaveProperty("fingerprint");
      expect(records[0]).not.toHaveProperty("hash");
    },
  );

  it("allocates a new operation only after the durable scope is explicitly released", async () => {
    const fixture = setup();
    const command: V2Command = {
      kind: "thread.fork",
      threadId: "thread-a",
      throughTurnId: "turn-a",
    };

    await expect(fixture.owner.execute(server, command)).rejects.toBeInstanceOf(
      CommandActivationError,
    );
    await fixture.owner.release(server, command);
    await expect(fixture.owner.execute(server, command)).rejects.toMatchObject({
      operationId: "operation-2",
    });

    expect(fixture.calls.map((call) => call.operationId)).toEqual(["operation-1", "operation-2"]);
  });

  it("atomically collapses concurrent activations in one semantic scope", async () => {
    const fixture = setup();
    const command: V2Command = {
      kind: "process.terminate",
      processId: "process-a",
      threadId: "thread-a",
    };

    await Promise.allSettled([
      fixture.owner.execute(server, command),
      fixture.owner.execute(server, command),
    ]);

    expect(fixture.calls).toHaveLength(1);
  });

  it("does not substitute a recovered terminal operation for a newer semantic request", async () => {
    const correlations = createCommandCorrelationStore();
    const command: V2Command = {
      change: { archived: false, kind: "archive" },
      kind: "thread.update",
      threadId: "thread-a",
    };
    const capabilities = new CommandCapabilities({
      correlationId: () => "candidate-correlation",
      correlations,
      now: () => 2,
      operationId: () => "candidate-operation",
      sessions: {
        open: async () => ({
          session: {
            command: async () => {
              throw new Error("A recovered operation must not send the newer command");
            },
            operations: async () => [status("older-operation", "thread.update", "completed")],
            query: async (query: V2Query): Promise<V2QueryResult> => {
              if (query.kind !== "operation.get") throw new Error("Unexpected query");
              return {
                kind: "operation.get",
                operationId: query.operationId,
                receipt: {
                  acceptedAt: "2026-09-03T00:00:00Z",
                  result: { kind: "thread.update", thread: threadSummary(true) },
                  state: "completed",
                },
              };
            },
            state: "live",
            subscribe: (_listener: () => void) => () => undefined,
          },
        }),
      },
    });
    const owner = new CommandActivationOwner(capabilities);
    await correlations.begin({
      ...owner.scope(server, command),
      correlationId: "older-correlation",
      operationId: "older-operation",
      state: "durable",
      createdAtMs: 1,
      updatedAtMs: 1,
    });

    await expect(owner.execute(server, command)).rejects.toBeInstanceOf(
      CommandActivationRecoveredError,
    );
  });
});

interface AmbiguousCommandCase {
  first: V2Command;
  name: string;
  second: V2Command;
}

function ambiguousCommandCases(): AmbiguousCommandCase[] {
  return [
    {
      first: { kind: "thread.fork", threadId: "thread-a", throughTurnId: "turn-a" },
      name: "fork",
      second: { kind: "thread.fork", threadId: "thread-a", throughTurnId: "turn-b" },
    },
    {
      first: {
        kind: "queue.mutate",
        mutation: {
          editableInput: [{ kind: "text", text: "first private value" }],
          expectedRevision: "revision-1",
          itemId: "queue-a",
          kind: "edit",
        },
      },
      name: "queue edit",
      second: {
        kind: "queue.mutate",
        mutation: {
          editableInput: [{ kind: "text", text: "second private value" }],
          expectedRevision: "revision-1",
          itemId: "queue-a",
          kind: "edit",
        },
      },
    },
    {
      first: {
        change: {
          goal: { objective: "first private goal", status: "active", tokenBudget: null },
          kind: "goal",
        },
        kind: "thread.update",
        threadId: "thread-a",
      },
      name: "goal update",
      second: {
        change: {
          goal: { objective: "second private goal", status: "active", tokenBudget: null },
          kind: "goal",
        },
        kind: "thread.update",
        threadId: "thread-a",
      },
    },
    {
      first: { kind: "process.terminate", processId: "process-a", threadId: "thread-a" },
      name: "process termination",
      second: { kind: "process.terminate", processId: "process-a", threadId: "thread-a" },
    },
    {
      first: {
        generation: "4",
        kind: "request.resolve",
        requestId: "approval-a",
        resolution: { decision: "accept", kind: "commandApproval" },
      },
      name: "request resolution",
      second: {
        generation: "4",
        kind: "request.resolve",
        requestId: "approval-a",
        resolution: { decision: "decline", kind: "commandApproval" },
      },
    },
  ];
}

function setup() {
  const correlations = createCommandCorrelationStore();
  const operations: V2OperationStatus[] = [];
  const calls: Array<{ command: V2Command; operationId: string }> = [];
  let identity = 0;
  const session = {
    command: async (operationId: string, command: V2Command): Promise<V2CommandTerminalFrame> => {
      calls.push({ command, operationId });
      operations.push(status(operationId, command.kind));
      throw new SyncV2CommandDurableUnsettledError(operationId);
    },
    operations: async () => operations,
    query: async (_query: V2Query): Promise<V2QueryResult> => {
      throw new Error("A sent operation does not have a terminal receipt");
    },
    state: "live",
    subscribe: (_listener: () => void) => () => undefined,
  };
  const commands = new CommandCapabilities({
    correlationId: () => `correlation-${++identity}`,
    correlations,
    now: () => identity,
    operationId: () => `operation-${identity}`,
    sessions: { open: async () => ({ session }) },
  });
  return { calls, correlations, owner: new CommandActivationOwner(commands) };
}

function status(
  operationId: string,
  commandKind: V2Command["kind"],
  state: V2OperationStatus["state"] = "sent",
): V2OperationStatus {
  return {
    acceptedAt: null,
    commandKind,
    createdAtMs: 1,
    operationId,
    state,
    terminalClass: state === "completed" ? "completed" : null,
    updatedAtMs: 1,
  };
}

function threadSummary(archived: boolean) {
  return {
    archived,
    createdAt: "2026-09-03T00:00:00Z",
    headTurnId: null,
    id: "thread-a",
    lastActivityAt: null,
    parentId: null,
    preview: "",
    readState: {
      kind: "unknown" as const,
      latestActivityMarker: null,
      readThroughMarker: null,
      unreadCount: null,
    },
    settings: {
      approvalPolicy: "onRequest" as const,
      effort: null,
      model: null,
      personality: null,
      sandbox: "workspaceWrite" as const,
    },
    state: "idle" as const,
    title: "Thread",
    updatedAt: "2026-09-03T00:00:00Z",
    workspace: "/workspace",
  };
}

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

import { v2SavedServerId, type V2Command } from "@codewide/sync-client/v2";

vi.mock("../src/v2/infrastructure/persistence/v2Database.native", () => ({
  getV2SqliteDatabase: () => {
    throw new Error("test must inject its SQLite database");
  },
}));

import { createNativeSyncV2OperationStoreWithDatabase } from "../src/v2/infrastructure/persistence/sqliteOperationStore.native";
import { createNativeSyncV2ProjectionStoreWithDatabase } from "../src/v2/infrastructure/persistence/sqliteProjectionStore.native";
import { createNativeSyncV2SavedServerDeletionStoreWithDatabase } from "../src/v2/infrastructure/persistence/sqliteSavedServerDeletionStore.native";
import { createCommandCorrelationStoreWithDatabase } from "../src/v2/infrastructure/persistence/sqliteCommandCorrelationStore.native";
import { createThreadPinStoreWithDatabase } from "../src/v2/infrastructure/persistence/sqliteThreadPinStore.native";
import { createComposerDraftStoreWithDatabase } from "../src/v2/infrastructure/persistence/sqliteComposerDraftStore.native";
import { createTerminalSessionStoreWithDatabase } from "../src/v2/infrastructure/persistence/sqliteTerminalSessionStore.native";
import { serializeSqliteTransactions } from "../src/v2/infrastructure/persistence/serialSqliteDatabase";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";

const savedServerA = v2SavedServerId("saved-server-native-a");
const savedServerB = v2SavedServerId("saved-server-native-b");
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("native Sync V2 durable stores", () => {
  it("restores terminal identities and deletes one saved-server namespace", async () => {
    const database = memoryDatabase();
    const first = createTerminalSessionStoreWithDatabase(database);
    const server = savedServerId("terminal-server");
    await first.upsert({
      cols: 120,
      cwd: "/workspace",
      generation: "7",
      id: "terminal-a",
      owner: qualifiedThread(server, threadId("thread-a")),
      rows: 40,
      title: "Terminal 1",
    });

    const restarted = createTerminalSessionStoreWithDatabase(database);
    expect(await restarted.list()).toStrictEqual([
      {
        cols: 120,
        cwd: "/workspace",
        generation: "7",
        id: "terminal-a",
        owner: { savedServerId: server, threadId: "thread-a" },
        rows: 40,
        title: "Terminal 1",
      },
    ]);
    await restarted.deleteSavedServer(server);
    expect(await restarted.list()).toEqual([]);
  });

  it("restores complete V2 composer state and quarantines a corrupt draft without its payload", async () => {
    const database = memoryDatabase();
    const store = createComposerDraftStoreWithDatabase(database);
    const server = savedServerId("composer-server");
    await store.upsert({
      attachments: [
        {
          editor: null,
          error: null,
          local: {
            mediaType: "text/plain",
            name: "notes.txt",
            sizeBytes: 7,
            token: "file:///drafts/notes.txt",
          },
          remoteId: "attachment-1",
          state: "ready",
        },
      ],
      deliveryMode: "queue",
      draftId: "thread:thread-1",
      historyAnchorOffsetPx: 18,
      historyAnchorTurnId: "turn-8",
      historyGenerationId: "generation-1",
      historyPageCursor: "cursor-1",
      historyPageDirection: "older",
      newThread: {
        settings: {
          approvalPolicy: {
            granular: {
              mcpElicitations: false,
              requestPermissions: true,
              rules: false,
              sandboxApproval: true,
              skillApproval: false,
            },
          },
          effort: "ultra",
          model: "gpt-5.6-sol",
          personality: "pragmatic",
          sandbox: { networkAccess: "enabled", type: "externalSandbox" },
        },
        workspace: "/workspace/project",
        workspaceMode: {
          kind: "isolated",
          support: { canCreate: true, provider: "git", repositoryRoot: "/workspace/project" },
        },
      },
      savedServerId: server,
      text: "persist me",
      updatedAtMs: 10,
    });
    expect(await createComposerDraftStoreWithDatabase(database).load()).toMatchObject([
      {
        deliveryMode: "queue",
        draftId: "thread:thread-1",
        historyAnchorTurnId: "turn-8",
        newThread: {
          settings: {
            approvalPolicy: {
              granular: {
                mcpElicitations: false,
                requestPermissions: true,
                rules: false,
                sandboxApproval: true,
                skillApproval: false,
              },
            },
            sandbox: { networkAccess: "enabled", type: "externalSandbox" },
          },
          workspace: "/workspace/project",
          workspaceMode: { kind: "isolated" },
        },
        text: "persist me",
      },
    ]);

    const legacyDraftId = "thread:legacy-thread";
    await database.execute(
      "INSERT INTO codewide_v2_composer_drafts(saved_server_id, draft_id, payload, updated_at_ms) VALUES (?, ?, ?, ?)",
      [
        server,
        legacyDraftId,
        JSON.stringify({
          attachments: [],
          deliveryMode: "sendNow",
          draftId: legacyDraftId,
          savedServerId: server,
          text: "legacy draft",
          updatedAtMs: 9,
        }),
        9,
      ],
    );
    expect(await createComposerDraftStoreWithDatabase(database).load()).toContainEqual(
      expect.objectContaining({
        draftId: legacyDraftId,
        historyAnchorOffsetPx: null,
        historyAnchorTurnId: null,
        historyGenerationId: null,
        historyPageCursor: null,
        historyPageDirection: null,
        text: "legacy draft",
      }),
    );

    await database.execute(
      "UPDATE codewide_v2_composer_drafts SET payload = ? WHERE saved_server_id = ? AND draft_id = ?",
      ["{broken", server, "thread:thread-1"],
    );
    expect(await createComposerDraftStoreWithDatabase(database).load()).toMatchObject([
      { draftId: legacyDraftId, text: "legacy draft" },
    ]);
    const quarantine = await database.execute(
      "SELECT reason FROM codewide_v2_composer_draft_quarantine WHERE saved_server_id = ?",
      [server],
    );
    expect(quarantine).toEqual({ rows: [{ reason: "invalid_payload" }] });
  });

  it("serializes transactions shared by independent V2 stores", async () => {
    let active = false;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const database = serializeSqliteTransactions({
      async execute() {
        return { rows: [] };
      },
      async transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> {
        if (active) throw new Error("native transaction slot overlapped");
        active = true;
        try {
          return await operation({
            async execute() {
              return { rows: [] };
            },
          });
        } finally {
          active = false;
        }
      },
    });

    const first = database.transaction(async () => {
      firstEntered();
      await firstBlocked;
      return "first";
    });
    await entered;
    const second = database.transaction(async () => "second");
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
  });

  it("persists content-free command correlation and rejects identity drift", async () => {
    const database = memoryDatabase();
    const first = createCommandCorrelationStoreWithDatabase(database);
    const record = {
      correlationId: "correlation-a",
      operationId: "operation-a",
      savedServerId: savedServerA,
      surface: "threadComposer" as const,
      threadId: "thread-a",
      state: "allocating" as const,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    await first.begin(record);
    await first.markDurable(record.correlationId, 2);
    await first.release(record.correlationId, 3);
    await first.markDurable(record.correlationId, 4);

    const restarted = createCommandCorrelationStoreWithDatabase(database);
    expect(
      await restarted.listUnsettled({
        savedServerId: savedServerA,
        surface: "threadComposer",
        threadId: "thread-a",
      }),
    ).toEqual([expect.objectContaining({ operationId: "operation-a", state: "durableReleased" })]);
    await expect(restarted.begin({ ...record, operationId: "operation-b" })).rejects.toThrow(
      "identity is immutable",
    );
    const columns = databases
      .at(-1)!
      .prepare("PRAGMA table_info(codewide_v2_command_correlations)")
      .all()
      .map((row) => Reflect.get(row, "name"));
    expect(columns).not.toContain("command");
    expect(columns).not.toContain("prompt");
    expect(columns).not.toContain("fingerprint");
  });

  it("quarantines an invalid command correlation and keeps its scope locked", async () => {
    const database = memoryDatabase();
    const store = createCommandCorrelationStoreWithDatabase(database);
    const scope = {
      savedServerId: savedServerA,
      surface: "commandAction" as const,
      threadId: "11:thread.fork|8:thread-a",
    };
    await store.begin({
      ...scope,
      correlationId: "correlation-corrupt",
      operationId: "operation-corrupt",
      state: "durable",
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    await database.execute(
      "UPDATE codewide_v2_command_correlations SET operation_id = '' WHERE correlation_id = ?",
      ["correlation-corrupt"],
    );

    await expect(store.listUnsettled(scope)).rejects.toThrow("explicit user decision");
    await expect(store.listUnsettled(scope)).rejects.toThrow("explicit user decision");
    expect(
      await database.execute(
        "SELECT reason FROM codewide_v2_command_correlation_quarantine WHERE scope_key IS NOT NULL",
      ),
    ).toEqual({ rows: [{ reason: "invalid_record" }] });

    await store.releaseScope(scope, 2);
    await expect(store.listUnsettled(scope)).resolves.toEqual([]);
  });

  it("persists thread pins per saved server and removes their deleted namespace", async () => {
    const database = memoryDatabase();
    const first = createThreadPinStoreWithDatabase(database);
    const serverA = savedServerId("saved-server-native-a");
    const serverB = savedServerId("saved-server-native-b");
    const threadA = threadId("thread-a");
    await first.setPinned(serverA, threadA, true);
    await first.setPinned(serverB, threadA, true);

    const restarted = createThreadPinStoreWithDatabase(database);
    expect(await restarted.list()).toEqual([
      { savedServerId: serverA, threadId: threadA },
      { savedServerId: serverB, threadId: threadA },
    ]);

    await restarted.setPinned(serverA, threadA, false);
    expect(await restarted.list()).toEqual([{ savedServerId: serverB, threadId: threadA }]);

    await restarted.deleteSavedServer(serverA);
    expect(await restarted.list()).toEqual([{ savedServerId: serverB, threadId: threadA }]);
  });

  it("survives restart, isolates saved servers, and deactivates an abandoned generation", async () => {
    const database = memoryDatabase();
    const first = createNativeSyncV2ProjectionStoreWithDatabase(database);
    await first.commitSnapshot(savedServerA, snapshot("epoch-a", "thread-a"));
    await first.commitSnapshot(savedServerB, snapshot("epoch-b", "thread-b"));
    await first.abandonEpoch(savedServerA, "epoch-a");
    expect(await first.active(savedServerA)).toBeNull();
    expect((await first.retained(savedServerA))?.catalog[0]?.thread.id).toBe("thread-a");
    expect((await first.active(savedServerB))?.epochId).toBe("epoch-b");

    const restarted = createNativeSyncV2ProjectionStoreWithDatabase(database);
    expect((await restarted.active(savedServerB))?.sourceGeneration).toBe("1");
    expect((await restarted.active(savedServerB))?.catalog[0]?.thread.id).toBe("thread-b");
    await restarted.commitSnapshot(savedServerA, snapshot("epoch-a2", "thread-a2"));
    expect((await restarted.active(savedServerA))?.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          thread: expect.objectContaining({ id: "thread-a" }),
          coverage: "outsideCurrentScope",
        }),
        expect.objectContaining({
          thread: expect.objectContaining({ id: "thread-a2" }),
          coverage: "current",
        }),
      ]),
    );
  });

  it("does not publish projections persisted with the previous payload schema", async () => {
    const database = memoryDatabase();
    await database.execute(
      "CREATE TABLE codewide_sync_v2_projection_by_saved_server (saved_server_id TEXT NOT NULL, generation_id TEXT NOT NULL, epoch_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(saved_server_id, generation_id))",
    );
    await database.execute(
      "CREATE TABLE codewide_sync_v2_active_by_saved_server (saved_server_id TEXT PRIMARY KEY NOT NULL, generation_id TEXT NOT NULL)",
    );
    await database.execute(
      "INSERT INTO codewide_sync_v2_projection_by_saved_server(saved_server_id, generation_id, epoch_id, payload) VALUES (?, ?, ?, ?)",
      [
        savedServerA,
        "legacy-generation",
        "legacy-epoch",
        JSON.stringify({
          catalog: [{ coverage: "current", thread: { id: "legacy-thread" } }],
          epochId: "legacy-epoch",
          generationId: "legacy-generation",
        }),
      ],
    );
    await database.execute(
      "INSERT INTO codewide_sync_v2_active_by_saved_server(saved_server_id, generation_id) VALUES (?, ?)",
      [savedServerA, "legacy-generation"],
    );

    const store = createNativeSyncV2ProjectionStoreWithDatabase(database);

    expect(await store.active(savedServerA)).toBeNull();
    expect(await store.retained(savedServerA)).toBeNull();
    expect(await store.hasSavedServerData(savedServerA)).toBe(false);
  });

  it("quarantines a malformed current projection instead of publishing unchecked JSON", async () => {
    const database = memoryDatabase();
    const store = createNativeSyncV2ProjectionStoreWithDatabase(database);
    await store.commitSnapshot(savedServerA, snapshot("epoch-a", "thread-a"));
    const persisted = await store.active(savedServerA);
    expect(persisted).not.toBeNull();
    await database.execute(
      "UPDATE codewide_sync_v2_projection_v2_by_saved_server SET payload = ? WHERE saved_server_id = ?",
      [
        JSON.stringify({
          ...persisted,
          catalog: persisted?.catalog.map((entry) => ({
            ...entry,
            thread: { ...entry.thread, title: 42 },
          })),
        }),
        savedServerA,
      ],
    );

    const restarted = createNativeSyncV2ProjectionStoreWithDatabase(database);
    expect(await restarted.active(savedServerA)).toBeNull();
    expect(await restarted.retained(savedServerA)).toBeNull();
    expect(await restarted.hasSavedServerData(savedServerA)).toBe(false);
  });

  it("commits projection quarantine even when a live change discovers the corruption", async () => {
    const database = memoryDatabase();
    const store = createNativeSyncV2ProjectionStoreWithDatabase(database);
    await store.commitSnapshot(savedServerA, snapshot("epoch-a", "thread-a"));
    await database.execute(
      "UPDATE codewide_sync_v2_projection_v2_by_saved_server SET payload = ? WHERE saved_server_id = ?",
      ["{broken", savedServerA],
    );

    await expect(
      store.applyChange(savedServerA, "epoch-a", "1", {
        kind: "accountsChanged",
        revision: "accounts:1",
      }),
    ).rejects.toThrow("does not belong to the active native generation");

    expect(await store.active(savedServerA)).toBeNull();
    expect(await store.retained(savedServerA)).toBeNull();
  });

  it("quarantines an invalid durable operation before recovery", async () => {
    const database = memoryDatabase();
    const store = createNativeSyncV2OperationStoreWithDatabase(database);
    const operation = await store.create(savedServerA, "operation-a", {
      kind: "thread.delete",
      threadId: "thread-a",
    });
    await database.execute(
      "UPDATE codewide_sync_v2_operations_by_saved_server SET payload = ? WHERE saved_server_id = ? AND operation_id = ?",
      [
        JSON.stringify({
          ...operation,
          command: { kind: "thread.delete", threadId: "fingerprint-drift" },
        }),
        savedServerA,
        "operation-a",
      ],
    );

    const restarted = createNativeSyncV2OperationStoreWithDatabase(database);
    expect(await restarted.get(savedServerA, "operation-a")).toBeNull();
    expect(await restarted.recoverable(savedServerA)).toEqual([]);
    expect(await restarted.hasSavedServerData(savedServerA)).toBe(false);
  });

  it("commits operation quarantine even when a transition discovers the corruption", async () => {
    const database = memoryDatabase();
    const store = createNativeSyncV2OperationStoreWithDatabase(database);
    await store.create(savedServerA, "operation-a", {
      kind: "thread.delete",
      threadId: "thread-a",
    });
    await database.execute(
      "UPDATE codewide_sync_v2_operations_by_saved_server SET payload = ? WHERE saved_server_id = ? AND operation_id = ?",
      ["{broken", savedServerA, "operation-a"],
    );

    await expect(
      store.transition(savedServerA, "operation-a", ["created"], { state: "sent" }),
    ).rejects.toThrow("Unknown Sync V2 operation id");

    expect(await store.get(savedServerA, "operation-a")).toBeNull();
    expect(await store.hasSavedServerData(savedServerA)).toBe(false);
  });

  it("publishes complete content-free native store observations", async () => {
    const database = memoryDatabase();
    const projections = createNativeSyncV2ProjectionStoreWithDatabase(database);
    const durableCreates: unknown[] = [];
    const operations = createNativeSyncV2OperationStoreWithDatabase(database, (observation) => {
      durableCreates.push(observation);
    });
    let projectionPublications = 0;
    let operationPublications = 0;
    projections.subscribe(savedServerA, () => {
      projectionPublications += 1;
    });
    operations.subscribe(savedServerA, () => {
      operationPublications += 1;
    });

    await projections.commitSnapshot(savedServerA, snapshot("epoch-a", "thread-a"));
    await operations.create(savedServerA, "operation", {
      kind: "thread.delete",
      threadId: "thread-a",
    });

    expect((await projections.retained(savedServerA))?.epochId).toBe("epoch-a");
    expect(await operations.list(savedServerA)).toEqual([
      expect.objectContaining({
        operationId: "operation",
        commandKind: "thread.delete",
        state: "created",
      }),
    ]);
    expect((await operations.list(savedServerA))[0]).not.toHaveProperty("command");
    expect(projectionPublications).toBe(1);
    expect(operationPublications).toBe(1);
    expect(durableCreates).toEqual([{ commandKind: "thread.delete", operationId: "operation" }]);
    expect(durableCreates[0]).not.toHaveProperty("command");
  });

  it("isolates a throwing durable-create observer and emits only for a new row", async () => {
    const observe = vi.fn(() => {
      throw new Error("diagnostic sink failed");
    });
    const operations = createNativeSyncV2OperationStoreWithDatabase(memoryDatabase(), observe);
    const command = { kind: "thread.delete", threadId: "thread-a" } as const;

    await expect(operations.create(savedServerA, "operation-a", command)).resolves.toMatchObject({
      operationId: "operation-a",
      state: "created",
    });
    await expect(operations.create(savedServerA, "operation-a", command)).resolves.toMatchObject({
      operationId: "operation-a",
      state: "created",
    });

    expect(observe).toHaveBeenCalledTimes(1);
    expect(await operations.get(savedServerA, "operation-a")).toMatchObject({
      operationId: "operation-a",
      state: "created",
    });
  });

  it("takes immutable command ownership before the first asynchronous persistence boundary", async () => {
    const operations = createNativeSyncV2OperationStoreWithDatabase(memoryDatabase());
    const command: Extract<V2Command, { kind: "turn.submit" }> = {
      input: [{ kind: "text" as const, text: "original" }],
      intent: "chat" as const,
      kind: "turn.submit" as const,
      settings: null,
      threadId: "thread-a",
      workspace: null,
    };

    const creating = operations.create(savedServerA, "operation-a", command);
    const input = command.input[0];
    if (input?.kind !== "text") throw new Error("test command must contain text input");
    expect(Reflect.set(input, "text", "mutated after create")).toBe(false);

    const operation = await creating;
    expect(operation.command).toBe(command);
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.input)).toBe(true);
    expect(Object.isFrozen(input)).toBe(true);
    expect(operation.command).toMatchObject({ input: [{ kind: "text", text: "original" }] });
    const restored = await operations.get(savedServerA, "operation-a");
    expect(restored).toMatchObject({
      command: { input: [{ kind: "text", text: "original" }] },
    });
    expect(restored?.command).not.toBe(command);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.command)).toBe(true);
    if (restored?.command?.kind !== "turn.submit") {
      throw new Error("restored test command must be turn.submit");
    }
    const restoredInput = restored.command.input[0];
    if (restoredInput?.kind !== "text") throw new Error("restored command must contain text input");
    expect(Reflect.set(restoredInput, "text", "mutated restored value")).toBe(false);
    expect(await operations.get(savedServerA, "operation-a")).toMatchObject({
      command: { input: [{ kind: "text", text: "original" }] },
    });
  });

  it("serializes back-to-back native projection changes", async () => {
    const store = createNativeSyncV2ProjectionStoreWithDatabase(memoryDatabase());
    await store.commitSnapshot(savedServerA, snapshot("epoch-a", "thread-a"));
    const first = store.applyChange(savedServerA, "epoch-a", "1", {
      kind: "resourcesChanged",
      threadId: "thread-a",
      revision: "resources:1",
    });
    const second = store.applyChange(savedServerA, "epoch-a", "2", {
      kind: "accountsChanged",
      revision: "accounts:1",
    });
    await Promise.all([first, second]);
    expect(await store.active(savedServerA)).toMatchObject({
      watermark: "2",
      resourceRevisions: { "thread-a": "resources:1" },
      accountsRevision: "accounts:1",
    });
  });

  it("rolls back native publication when abandonment races the active-marker switch", async () => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const database = memoryDatabase(async (sql) => {
      if (sql.startsWith("INSERT INTO codewide_sync_v2_projection_v2_by_saved_server")) {
        entered();
        await blocked;
      }
    });
    const store = createNativeSyncV2ProjectionStoreWithDatabase(database);
    const controller = new AbortController();
    const commit = store.commitSnapshot(
      savedServerA,
      snapshot("epoch-a", "thread-a"),
      controller.signal,
    );
    await started;
    controller.abort();
    release();
    expect(await commit).toBeNull();
    expect(await store.active(savedServerA)).toBeNull();
  });

  it("serializes accepted-to-terminal transitions and recovers sent state after restart", async () => {
    const database = memoryDatabase();
    const first = createNativeSyncV2OperationStoreWithDatabase(database);
    await first.create(savedServerA, "accepted", { kind: "thread.delete", threadId: "thread" }, 0);
    await first.transition(savedServerA, "accepted", ["created"], { state: "sent" }, 0);
    const accepted = first.transition(
      savedServerA,
      "accepted",
      ["sent"],
      { state: "accepted", acceptedAt: "2026-08-27T12:00:00Z" },
      1,
    );
    const terminal = first.transition(
      savedServerA,
      "accepted",
      ["accepted"],
      { state: "completed" },
      2,
    );
    await Promise.all([accepted, terminal]);

    await first.create(
      savedServerA,
      "unconfirmed",
      { kind: "thread.delete", threadId: "thread" },
      0,
    );
    await first.transition(savedServerA, "unconfirmed", ["created"], { state: "sent" }, 0);
    const restarted = createNativeSyncV2OperationStoreWithDatabase(database);
    expect((await restarted.get(savedServerA, "accepted"))?.state).toBe("completed");
    expect(
      (await restarted.recoverable(savedServerA, 1)).map(({ operationId }) => operationId),
    ).toEqual(["unconfirmed"]);
  });

  it.each([
    ["rejected", false],
    ["expired", false],
    ["failed", true],
    ["indeterminate", true],
    ["completed", true],
  ] as const)("persists native %s lifecycle state atomically", async (state, accepted) => {
    const store = createNativeSyncV2OperationStoreWithDatabase(memoryDatabase());
    await store.create(savedServerA, state, { kind: "thread.delete", threadId: "thread" }, 0);
    await store.transition(savedServerA, state, ["created"], { state: "sent" }, 0);
    if (accepted)
      await store.transition(
        savedServerA,
        state,
        ["sent"],
        { state: "accepted", acceptedAt: "2026-08-27T12:00:00Z" },
        1,
      );
    await store.transition(savedServerA, state, [accepted ? "accepted" : "sent"], { state }, 2);
    const persisted = await store.get(savedServerA, state);
    expect(persisted?.state).toBe(state);
    expect(persisted?.command).toBeNull();
    expect(persisted).not.toHaveProperty("result");
    expect(persisted).not.toHaveProperty("error");
  });

  it("durably rejects duplicate, conflicting, and out-of-order native transitions", async () => {
    const database = memoryDatabase();
    const store = createNativeSyncV2OperationStoreWithDatabase(database);
    await store.create(savedServerA, "terminal", { kind: "thread.delete", threadId: "thread" }, 0);
    await store.transition(savedServerA, "terminal", ["created"], { state: "sent" }, 0);
    await expect(
      store.transition(savedServerA, "terminal", ["accepted"], { state: "completed" }, 1),
    ).rejects.toThrow("rejected from sent");
    await store.transition(
      savedServerA,
      "terminal",
      ["sent"],
      { state: "accepted", acceptedAt: "2026-08-27T12:00:00Z" },
      2,
    );
    await store.transition(savedServerA, "terminal", ["accepted"], { state: "completed" }, 3);
    await expect(
      store.transition(savedServerA, "terminal", ["accepted"], { state: "completed" }, 4),
    ).rejects.toThrow("rejected from completed");
    await expect(
      store.transition(savedServerA, "terminal", ["accepted"], { state: "failed" }, 5),
    ).rejects.toThrow("rejected from completed");
    await expect(
      store.transition(
        savedServerA,
        "terminal",
        ["sent"],
        { state: "accepted", acceptedAt: "2026-08-27T12:00:01Z" },
        6,
      ),
    ).rejects.toThrow("rejected from completed");
    const restarted = createNativeSyncV2OperationStoreWithDatabase(database);
    expect(await restarted.get(savedServerA, "terminal")).toMatchObject({
      state: "completed",
      terminalClass: "completed",
    });
  });

  it("purges exactly one native saved-server partition", async () => {
    const database = memoryDatabase();
    const projections = createNativeSyncV2ProjectionStoreWithDatabase(database);
    const operations = createNativeSyncV2OperationStoreWithDatabase(database);
    await projections.commitSnapshot(savedServerA, snapshot("epoch-a", "thread-a"));
    await projections.commitSnapshot(savedServerB, snapshot("epoch-b", "thread-b"));
    await operations.create(savedServerA, "same", { kind: "thread.delete", threadId: "thread-a" });
    await operations.create(savedServerB, "same", { kind: "thread.delete", threadId: "thread-b" });
    await Promise.all([
      projections.deleteSavedServer(savedServerA),
      operations.deleteSavedServer(savedServerA),
    ]);
    expect(await projections.active(savedServerA)).toBeNull();
    expect(await operations.get(savedServerA, "same")).toBeNull();
    expect(await projections.active(savedServerB)).not.toBeNull();
    expect(await operations.get(savedServerB, "same")).not.toBeNull();
  });

  it("persists the native deletion barrier across store recreation", async () => {
    const database = memoryDatabase();
    const first = createNativeSyncV2SavedServerDeletionStoreWithDatabase(database);
    await first.begin(savedServerA);
    expect(await first.pending(savedServerA)).toBe(true);

    const restarted = createNativeSyncV2SavedServerDeletionStoreWithDatabase(database);
    expect(await restarted.listPending()).toEqual([savedServerA]);
    await restarted.complete(savedServerA);
    expect(await first.pending(savedServerA)).toBe(false);
  });

  it("keeps a native deletion intent through partial purge failure and completes an idempotent restart retry", async () => {
    let failProjectionPurge = false;
    const database = memoryDatabase(async (sql) => {
      if (
        failProjectionPurge &&
        sql.startsWith(
          "DELETE FROM codewide_sync_v2_projection_v2_by_saved_server WHERE saved_server_id",
        )
      ) {
        failProjectionPurge = false;
        throw new Error("injected native projection purge failure");
      }
    });
    const projections = createNativeSyncV2ProjectionStoreWithDatabase(database);
    const operations = createNativeSyncV2OperationStoreWithDatabase(database);
    const deletions = createNativeSyncV2SavedServerDeletionStoreWithDatabase(database);
    await projections.commitSnapshot(savedServerA, snapshot("epoch-a", "thread-a"));
    await operations.create(savedServerA, "operation", {
      kind: "thread.delete",
      threadId: "thread-a",
    });

    await deletions.begin(savedServerA);
    failProjectionPurge = true;
    const firstPurge = await Promise.allSettled([
      projections.deleteSavedServer(savedServerA),
      operations.deleteSavedServer(savedServerA),
    ]);
    expect(firstPurge.some(({ status }) => status === "rejected")).toBe(true);
    expect(await deletions.pending(savedServerA)).toBe(true);
    expect(await projections.hasSavedServerData(savedServerA)).toBe(true);
    expect(await operations.hasSavedServerData(savedServerA)).toBe(false);

    const restartedProjections = createNativeSyncV2ProjectionStoreWithDatabase(database);
    const restartedOperations = createNativeSyncV2OperationStoreWithDatabase(database);
    const restartedDeletions = createNativeSyncV2SavedServerDeletionStoreWithDatabase(database);
    expect(await restartedDeletions.listPending()).toEqual([savedServerA]);
    await Promise.all([
      restartedProjections.deleteSavedServer(savedServerA),
      restartedOperations.deleteSavedServer(savedServerA),
    ]);
    expect(await restartedProjections.hasSavedServerData(savedServerA)).toBe(false);
    expect(await restartedOperations.hasSavedServerData(savedServerA)).toBe(false);
    await restartedDeletions.complete(savedServerA);
    expect(await restartedDeletions.pending(savedServerA)).toBe(false);
  });
});

function memoryDatabase(beforeExecute?: (sql: string) => Promise<void>): SqliteDatabase {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  const executor: SqliteExecutor = {
    async execute(sql: string, params: readonly SqliteValue[] = []) {
      await beforeExecute?.(sql);
      const statement = sqlite.prepare(sql);
      const values = params as readonly (string | number | null | bigint | Uint8Array)[];
      if (/^\s*(?:SELECT|PRAGMA)/iu.test(sql))
        return { rows: statement.all(...values) as Array<Record<string, SqliteValue>> };
      statement.run(...values);
      return { rows: [] };
    },
  };
  let chain = Promise.resolve();
  return {
    ...executor,
    transaction<T>(operation: (target: SqliteExecutor) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await operation(executor);
          sqlite.exec("COMMIT");
          return result;
        } catch (cause: unknown) {
          sqlite.exec("ROLLBACK");
          throw cause;
        }
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function snapshot(epochId: string, threadId: string) {
  return {
    type: "snapshot" as const,
    version: 2 as const,
    sourceGeneration: "1",
    epochId,
    revision: `sync-v2-revision:${epochId}`,
    watermark: "0",
    scope: {
      active: { limit: 2, returned: 1, complete: true },
      archived: { limit: 1, returned: 0, complete: true },
    },
    catalog: {
      active: [
        {
          id: threadId,
          parentId: null,
          title: threadId,
          preview: "",
          workspace: "/workspace",
          archived: false,
          state: "idle" as const,
          settings: {
            model: null,
            effort: null,
            approvalPolicy: "onRequest" as const,
            sandbox: "workspaceWrite" as const,
            personality: null,
          },
          readState: {
            kind: "unknown" as const,
            latestActivityMarker: null,
            readThroughMarker: null,
            unreadCount: null,
          },
          createdAt: "2026-08-27T12:00:00Z",
          updatedAt: "2026-08-27T12:00:00Z",
          lastActivityAt: null,
          headTurnId: null,
        },
      ],
      archived: [],
    },
    currentThread: null,
    pendingRequests: [],
    includedTail: [],
    limits: {
      catalogPerPartitionMax: 100,
      turnWindowMax: 36,
      historyPageMax: 100,
      queueMaxEvents: 2_048,
      queueMaxBytes: 4_194_304,
    },
  };
}

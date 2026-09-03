import {
  MemoryV2SavedServerDeletionStore,
  type V2OperationStore,
  type V2ProjectionStore,
  type V2SavedServerDeletionStore,
  v2SavedServerId,
} from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import type { CommandCorrelationStore } from "../src/v2/application/commandCorrelation";
import type { ComposerAttachmentTransport } from "../src/v2/application/ports/composerAttachmentTransport";
import type { ComposerDraftStore } from "../src/v2/application/ports/composerDraftStore";
import type { SavedServerRepository } from "../src/v2/application/ports/savedServerRepository";
import type { TerminalSessionStore } from "../src/v2/application/ports/terminalSessionStore";
import type { ThreadPinStore } from "../src/v2/application/ports/threadPinStore";
import type { RuntimeSessionProvider } from "../src/v2/application/v2Runtime";
import { V2Runtime } from "../src/v2/application/v2Runtime";
import type { SavedServerId } from "../src/v2/domain/ids";
import { savedServerId } from "../src/v2/domain/ids";
import type { SavedServer } from "../src/v2/domain/savedServer";
import { createClosedPortTransport } from "../src/v2/infrastructure/ports/closedPortTransport.web";
import { createClosedPreviewTransport } from "../src/v2/infrastructure/preview/closedPreviewTransport.web";

interface CrashableRepository extends SavedServerRepository {
  deleteCalls: SavedServerId[];
  nativeCredentials: Set<SavedServerId>;
  profiles: Set<SavedServerId>;
}

interface PartitionStores {
  correlations: Set<SavedServerId>;
  drafts: Set<SavedServerId>;
  operations: Set<string>;
  pins: Set<SavedServerId>;
  projections: Set<string>;
  terminals: Set<SavedServerId>;
}

const deletedServerId = savedServerId("saved-server-deleted");
const retainedServerId = savedServerId("saved-server-retained");

describe("V2 saved-server deletion recovery", () => {
  it("finishes native and local deletion after startup crashes without resurrecting the server", async () => {
    const deletions = new MemoryV2SavedServerDeletionStore();
    const repository = crashableRepository();
    const partitions = partitionStores();
    await deletions.begin(v2SavedServerId(deletedServerId));

    const firstRestart = runtimeFixture(deletions, repository, partitions);
    await expect(firstRestart.start()).rejects.toThrow("injected crash after native deletion");
    expect(await deletions.pending(v2SavedServerId(deletedServerId))).toBe(true);
    expect(repository.nativeCredentials.has(deletedServerId)).toBe(false);
    expect(repository.profiles.has(deletedServerId)).toBe(true);
    expect(repository.nativeCredentials.has(retainedServerId)).toBe(true);
    expect(repository.profiles.has(retainedServerId)).toBe(true);

    const secondRestart = runtimeFixture(deletions, repository, partitions);
    await secondRestart.start();

    expect(repository.deleteCalls).toEqual([deletedServerId, deletedServerId]);
    expect(repository.nativeCredentials.has(deletedServerId)).toBe(false);
    expect(repository.profiles.has(deletedServerId)).toBe(false);
    expect(await deletions.pending(v2SavedServerId(deletedServerId))).toBe(false);
    expect(partitions.correlations.has(deletedServerId)).toBe(false);
    expect(partitions.drafts.has(deletedServerId)).toBe(false);
    expect(partitions.operations.has(deletedServerId)).toBe(false);
    expect(partitions.pins.has(deletedServerId)).toBe(false);
    expect(partitions.projections.has(deletedServerId)).toBe(false);
    expect(partitions.terminals.has(deletedServerId)).toBe(false);

    expect(repository.nativeCredentials.has(retainedServerId)).toBe(true);
    expect(repository.profiles.has(retainedServerId)).toBe(true);
    expect(partitions.correlations.has(retainedServerId)).toBe(true);
    expect(partitions.drafts.has(retainedServerId)).toBe(true);
    expect(partitions.operations.has(retainedServerId)).toBe(true);
    expect(partitions.pins.has(retainedServerId)).toBe(true);
    expect(partitions.projections.has(retainedServerId)).toBe(true);
    expect(partitions.terminals.has(retainedServerId)).toBe(true);
    expect(secondRestart.savedServers.snapshot().value.map((server) => server.id)).toEqual([
      retainedServerId,
    ]);
    expect(secondRestart.selection.snapshot().value).toEqual({ kind: "all" });
    expect(secondRestart.aggregate.snapshot().value.selection).toEqual({ kind: "all" });
    await secondRestart.stop();
  });
});

function runtimeFixture(
  deletions: V2SavedServerDeletionStore,
  repository: SavedServerRepository,
  partitions: PartitionStores,
): V2Runtime {
  return new V2Runtime({
    attachmentTransport: attachmentTransport(),
    composerDrafts: composerDraftStore(partitions.drafts),
    correlationId: () => "correlation-test",
    correlations: correlationStore(partitions.correlations),
    deletions,
    documentViewerPreferences: {
      load: async () => null,
      save: async () => undefined,
    },
    now: () => 1,
    operationId: () => "operation-test",
    operations: operationStore(partitions.operations),
    portTransport: createClosedPortTransport(),
    previewTransport: createClosedPreviewTransport(),
    projections: projectionStore(partitions.projections),
    repository,
    savedServerId: () => savedServerId("unused-generated-server"),
    sessions: sessionProvider(),
    terminalLifecycle: { scheduleReconnect: () => () => undefined },
    terminalSessions: terminalStore(partitions.terminals),
    terminalTransport: {
      createSessionId: () => "terminal-test",
      open: async () => {
        throw new Error("Terminal transport must not open during deletion recovery");
      },
    },
    threadPins: threadPinStore(partitions.pins),
    voiceTransport: {
      start: async () => {
        throw new Error("Voice transport must not start during deletion recovery");
      },
    },
  });
}

function crashableRepository(): CrashableRepository {
  const records = new Map<SavedServerId, SavedServer>([
    [deletedServerId, serverRecord(deletedServerId, "Deleted")],
    [retainedServerId, serverRecord(retainedServerId, "Retained")],
  ]);
  const nativeCredentials = new Set(records.keys());
  const profiles = new Set(records.keys());
  const deleteCalls: SavedServerId[] = [];
  let injectCrash = true;
  return {
    close: () => undefined,
    connection: async (id) => ({
      enabled: false,
      endpoint: records.get(id)?.endpoint ?? "",
      id,
      tlsPinSha256: null,
    }),
    async delete(id) {
      deleteCalls.push(id);
      nativeCredentials.delete(id);
      if (injectCrash) {
        injectCrash = false;
        throw new Error("injected crash after native deletion");
      }
      profiles.delete(id);
      records.delete(id);
    },
    deleteCalls,
    async list() {
      const result: SavedServer[] = [];
      for (const [id, record] of records) {
        if (nativeCredentials.has(id) && profiles.has(id)) result.push(record);
      }
      return result;
    },
    move: async () => undefined,
    nativeCredentials,
    pair: async () => undefined,
    profiles,
    reconnect: () => undefined,
    setEnabled: async () => undefined,
    subscribe: () => () => undefined,
    update: async () => undefined,
  };
}

function partitionStores(): PartitionStores {
  return {
    correlations: new Set([deletedServerId, retainedServerId]),
    drafts: new Set([deletedServerId, retainedServerId]),
    operations: new Set([deletedServerId, retainedServerId]),
    pins: new Set([deletedServerId, retainedServerId]),
    projections: new Set([deletedServerId, retainedServerId]),
    terminals: new Set([deletedServerId, retainedServerId]),
  };
}

function serverRecord(id: SavedServerId, displayName: string): SavedServer {
  return {
    displayName,
    emoji: "computer",
    enabled: false,
    endpoint: `https://${id}.example.test`,
    id,
  };
}

function attachmentTransport(): ComposerAttachmentTransport {
  return {
    createBytes: () => {
      throw new Error("Attachment creation is unavailable in this test");
    },
    createText: () => {
      throw new Error("Attachment creation is unavailable in this test");
    },
    pick: async () => null,
    reference: () => {
      throw new Error("Attachment references are unavailable in this test");
    },
    release: () => undefined,
    restore: () => null,
    upload: () => {
      throw new Error("Attachment upload is unavailable in this test");
    },
  };
}

function composerDraftStore(partitions: Set<SavedServerId>): ComposerDraftStore {
  return {
    delete: async () => undefined,
    async deleteSavedServer(savedServerId) {
      partitions.delete(savedServerId);
    },
    load: async () => [],
    upsert: async () => undefined,
  };
}

function correlationStore(partitions: Set<SavedServerId>): CommandCorrelationStore {
  return {
    begin: async (record) => record,
    async deleteSavedServer(savedServerId) {
      partitions.delete(savedServerId);
    },
    get: async () => null,
    listUnsettled: async () => [],
    markDurable: async () => undefined,
    release: async () => undefined,
    releaseScope: async () => undefined,
    settle: async () => undefined,
  };
}

function operationStore(partitions: Set<string>): V2OperationStore {
  return {
    create: async () => {
      throw new Error("Operation creation is unavailable in this test");
    },
    async deleteSavedServer(savedServerId) {
      partitions.delete(savedServerId);
    },
    get: async () => null,
    hasSavedServerData: async (savedServerId) => partitions.has(savedServerId),
    list: async () => [],
    prune: async () => undefined,
    recoverable: async () => [],
    subscribe: () => () => undefined,
    transition: async () => {
      throw new Error("Operation transition is unavailable in this test");
    },
  };
}

function projectionStore(partitions: Set<string>): V2ProjectionStore {
  return {
    abandonEpoch: async () => undefined,
    active: async () => null,
    applyChange: async () => undefined,
    commitSnapshot: async () => null,
    async deleteSavedServer(savedServerId) {
      partitions.delete(savedServerId);
    },
    hasSavedServerData: async (savedServerId) => partitions.has(savedServerId),
    retained: async () => null,
    subscribe: () => () => undefined,
  };
}

function sessionProvider(): RuntimeSessionProvider {
  return {
    close: async () => undefined,
    closeAll: async () => undefined,
    open: async () => {
      throw new Error("Disabled saved servers must not open during deletion recovery");
    },
    reconnect: () => undefined,
    resource: () => {
      throw new Error("Projection resource is unavailable in this test");
    },
  };
}

function terminalStore(partitions: Set<SavedServerId>): TerminalSessionStore {
  return {
    delete: async () => undefined,
    async deleteSavedServer(savedServerId) {
      partitions.delete(savedServerId);
    },
    list: async () => [],
    upsert: async () => undefined,
  };
}

function threadPinStore(partitions: Set<SavedServerId>): ThreadPinStore {
  return {
    async deleteSavedServer(savedServerId) {
      partitions.delete(savedServerId);
    },
    list: async () => [],
    setPinned: async () => undefined,
  };
}

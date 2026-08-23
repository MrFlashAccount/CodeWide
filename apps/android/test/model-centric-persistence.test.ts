import { existsSync, readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dataDirectory = new URL("../src/data/", import.meta.url);

describe("model-centric persistence boundary", () => {
  it("has no active legacy persistence runtime", () => {
    const source = readdirSync(dataDirectory)
      .filter((name) => /\.(?:ts|tsx)$/u.test(name))
      .map((name) => readFileSync(new URL(name, dataDirectory), "utf8"))
      .join("\n");
    for (const legacyToken of [
      "@tanstack/react-native-db-sqlite-persistence",
      "persistedCollectionOptions",
      "commitUiCacheSyncDurably",
      "commitUiCacheMutationCheckpointed",
      "createSyncControlLease",
    ]) {
      expect(source).not.toContain(legacyToken);
    }
    for (const removedFile of [
      "coalesced-persistence.ts",
      "durable-commit-tracker.ts",
      "sync-control-lease.ts",
    ]) {
      expect(existsSync(new URL(removedFile, dataDirectory))).toBe(false);
    }
  });

  it("does not rebuild domain indexes by rescanning the hot collection", () => {
    const details = readFileSync(new URL("thread-detail-database.native.ts", dataDirectory), "utf8");
    const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
    expect(details).not.toContain("source.replaceLoaded(collection.toArray)");
    expect(screen).not.toContain("useRetainedReadyRows");
  });

  it("keeps old stores behind one-shot read-only migration boundaries", () => {
    const legacyStore = readFileSync(new URL("legacy-remote-store.native.ts", dataDirectory), "utf8");
    const uiState = readFileSync(new URL("thread-ui-state-database.native.ts", dataDirectory), "utf8");
    const uiStateTypes = readFileSync(new URL("thread-ui-state-types.ts", dataDirectory), "utf8");
    expect(legacyStore).toContain("Read-only adapter for the pre-TanStack Expo-SQLite database");
    expect(legacyStore).toContain("listConnections");
    expect(legacyStore).not.toContain("loadDraft(");
    expect(legacyStore).not.toContain("loadScrollOffset(");
    expect(legacyStore).not.toContain("loadComposerPreferences(");
    expect(uiState).toContain("getOrCreate(connectionId, threadId)");
    expect(uiState).not.toContain("seedLegacy");
    expect(uiStateTypes).not.toContain("migratedFromLegacy");
  });
});

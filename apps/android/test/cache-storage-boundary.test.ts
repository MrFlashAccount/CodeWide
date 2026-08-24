import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Android cache storage boundary", () => {
  const uiCache = source("../src/data/ui-cache-persistence.native.ts");
  const settings = source("../src/data/settings-persistence.native.ts");
  const profiles = source("../src/data/connection-profile-database.native.ts");
  const workspace = source("../src/data/use-remote-workspace.ts");
  const legacyStore = source("../src/data/legacy-remote-store.native.ts");
  const nativeTransport = source("../src/native/native-transport.native.ts");
  const frameStore = source("../android/app/src/main/java/dev/codewide/app/remote/NativeFrameStore.kt");
  const commandStore = source("../android/app/src/main/java/dev/codewide/app/remote/NativeCommandStore.kt");
  const cleanup = source("../android/app/src/main/java/dev/codewide/app/remote/DerivedStorageCleanup.kt");
  const nativeModule = source("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt");

  it("puts server-reconstructable SQLite stores under cacheDir", () => {
    expect(uiCache).toContain('return `${cacheDirectory}codex-remote/sqlite`');
    expect(uiCache).toContain('location: uiCacheDirectory()');
    expect(uiCache.match(/location: "default"/gu)).toHaveLength(1);
    expect(frameStore).toContain("context.cacheDir");
    expect(frameStore).toContain('"codex-remote/transport/codex-remote-frames.db"');
    expect(frameStore).not.toContain('context.getDatabasePath("codex-remote-frames.db")');
  });

  it("rotates sealed UI history by insertion age within a one-to-two GiB envelope", () => {
    const details = source("../src/data/thread-detail-sqlite.native.ts");
    expect(details).toContain("HISTORY_CACHE_SOFT_LIMIT_BYTES = 1 * 1024 * 1024 * 1024");
    expect(details).toContain("HISTORY_CACHE_HARD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024");
    expect(details).toContain('ORDER BY "first_rowid" ASC');
    expect(details).not.toContain("lastOpenedAt ASC");
    expect(details).not.toContain("last_accessed");
  });

  it("keeps server identity and the unfinished outbox durable", () => {
    expect(settings).toContain('name: "codex-remote-settings.db", location: "settings"');
    expect(profiles).toContain("getSettingsSqliteDatabase()");
    expect(profiles).not.toContain("getUiCacheSqliteDatabase()");
    expect(commandStore).toContain('context.getDatabasePath("codex-remote-native-commands.db")');
  });

  it("deletes only obsolete derived databases after profile recovery", () => {
    expect(cleanup).toContain('context.getDatabasePath("codex-remote.db")');
    expect(cleanup).toContain('"default"), "codex-remote-ui-cache.db"');
    expect(cleanup).toContain('context.getDatabasePath("codex-remote-frames.db")');
    expect(cleanup).not.toContain("codex-remote-native-commands.db");
    expect(nativeModule).toContain("fun purgeLegacyDerivedStorage(promise: Promise)");
    expect(nativeTransport).toContain("bridge.purgeLegacyDerivedStorage()");
    expect(profiles).toContain("async importLegacyUiCache()");
    expect(workspace).toContain("CONNECTION_PROFILE_STORAGE_MIGRATION_KEY");
    const startup = workspace.slice(workspace.indexOf("async function startWorkspaceRuntime"));
    expect(startup.indexOf("await profiles.importLegacyUiCache()")).toBeLessThan(
      startup.indexOf("await profiles.reconcileRuntimeConfigs(nativeConfigs)"),
    );
    expect(startup.indexOf("await profiles.reconcileRuntimeConfigs(nativeConfigs)")).toBeLessThan(
      startup.indexOf("await purgeLegacyDerivedStorage()"),
    );
  });

  it("does not reopen the obsolete data database while opening threads", () => {
    expect(workspace).not.toContain("legacyStore.loadDraft");
    expect(workspace).not.toContain("legacyStore.loadDraftAttachments");
    expect(workspace).not.toContain("legacyStore.loadScrollOffset");
    expect(workspace).not.toContain("legacyStore.loadComposerPreferences");
    expect(legacyStore).toContain("await this.#database.closeAsync()");
  });
});

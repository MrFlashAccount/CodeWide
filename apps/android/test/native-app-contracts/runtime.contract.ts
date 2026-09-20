import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sourceObjectDeclaration } from "../source-contract";
import {
  ownerWorkspaceRuntime,
  voiceWorkspace,
  sessionOwner,
  fileTransferController,
  connectionProfileDatabase,
  ownerConnectionRuntime,
  pendingRequestDatabase,
  connectionStateModel,
  uiCachePersistence,
  privateAsset,
} from "./runtime-sources";

it("preserves runtime integration contracts", () => {
  expect(ownerWorkspaceRuntime).toContain("new NativeEngineSupervisor");
  expect(voiceWorkspace).not.toContain("new MultiConnectionSupervisor");
  expect(voiceWorkspace).not.toContain("nativeJsSyncSocketFactory");
  expect(voiceWorkspace).toContain("await listNativeCommands()");
  expect(voiceWorkspace).not.toContain("commandDeliveries");
  expect(voiceWorkspace).not.toContain("applyHostQueue(connectionId, commands)");
  expect(voiceWorkspace).not.toContain("enqueueNativeCommand(connectionId, `turn-interrupt-");
  expect(voiceWorkspace).not.toContain("deliveries.stageTurn({");
  expect(voiceWorkspace).not.toContain("Voice transcription needs a live connection");
  expect(sessionOwner).toContain("mintNativeSession(connection.id)");
  expect(voiceWorkspace).not.toContain("capabilityToken: connection.token");
  expect(fileTransferController).toContain("this.isCurrent(options.scope, generation)");
  const versionFooter = readFileSync(
    new URL("../../src/features/settings/SettingsVersion.tsx", import.meta.url),
    "utf8",
  );
  expect(versionFooter).toContain("selectable={false}");
  expect(versionFooter).toContain("onLongPress={copy}");
  expect(voiceWorkspace).not.toContain("Audio upload is too slow");
  expect(voiceWorkspace).not.toContain("thread/realtime/");
  expect(voiceWorkspace).not.toContain('config: { "features.realtime_conversation": true }');
  const markdownDocument = readFileSync(
    new URL("../../src/rendering/MarkdownDocumentView.tsx", import.meta.url),
    "utf8",
  );
  const blockStyle = sourceObjectDeclaration(markdownDocument, "block");
  expect(blockStyle).toContain('width: "100%"');
  expect(blockStyle).toContain('alignSelf: "center"');
  expect(voiceWorkspace).not.toContain('reload(["connections"])');
  expect(voiceWorkspace).not.toContain("store.subscribe(");
  expect(ownerWorkspaceRuntime).toContain("createConnectionProfileDatabase()");
  expect(connectionProfileDatabase).toContain('id: "connection-profiles-v1"');
  expect(connectionProfileDatabase).toContain("await SecureStore.getItemAsync(tokenKey(row.id))");
  expect(connectionProfileDatabase).toContain('toStoredConnection(row, "")');
  expect(ownerConnectionRuntime).toContain("NATIVE_CREDENTIAL_MIGRATION_KEY");
  expect(ownerConnectionRuntime).not.toContain("LegacyRemoteStore");
  expect(voiceWorkspace).not.toContain("SqliteRemoteStore");
  expect(voiceWorkspace).not.toContain("store.hydrateThreadRuntimeMetadata");
  expect(voiceWorkspace).not.toContain("await store.getThread(");
  expect(voiceWorkspace).not.toContain("applyAncillaryEvents");
  expect(ownerWorkspaceRuntime).toContain("createPendingRequestDatabase()");
  expect(pendingRequestDatabase).toContain('id: "pending-server-requests-v1"');
  expect(ownerWorkspaceRuntime).toContain("createConnectionStateModel()");
  expect(connectionStateModel).toContain("observable<ConnectionStateRow[]>([])");
  expect(connectionStateModel).not.toContain("createPersistentCollectionModel");
  expect(connectionStateModel).not.toContain("getUiCacheSqliteDatabase");
  expect(voiceWorkspace).not.toContain("connectionState.collection");
  expect(ownerWorkspaceRuntime).toContain("createThreadUiStateDatabase()");
  expect(voiceWorkspace).not.toContain("requireStore(storeRef.current).saveDraft(");
  expect(voiceWorkspace).not.toContain("requireStore(storeRef.current).saveScrollOffset(");
  expect(voiceWorkspace).not.toContain("requireStore(storeRef.current).saveComposerPreferences(");
  expect(voiceWorkspace).not.toContain(
    'requireStore(storeRef.current).setConnectionState(connectionId, "connecting")',
  );
  expect(ownerWorkspaceRuntime).toContain("createThreadSummaryDatabase({");
  expect(ownerWorkspaceRuntime).toContain("globalSupervisorStorage: globalSupervisor.storage");
  expect(ownerWorkspaceRuntime).toContain("visibility: globalSupervisor.visibility");
  expect(
    ownerWorkspaceRuntime.indexOf("await createGlobalSupervisorWorkspaceBinding"),
  ).toBeLessThan(ownerWorkspaceRuntime.indexOf("createThreadSummaryDatabase({"));
  expect(voiceWorkspace).not.toContain("reconcileBeforeSummary");
  expect(uiCachePersistence).toContain("registerUiCacheCollectionFlusher");
  expect(uiCachePersistence).not.toContain("createReactNativeSQLitePersistence");
  expect(voiceWorkspace).not.toContain("() => threadDatabase?.collection");
  expect(voiceWorkspace).not.toContain("details.collection.preload()");
  expect(voiceWorkspace).not.toContain("createOptimisticAction");
  expect(voiceWorkspace).not.toContain("new DurableOutbox");
  expect(voiceWorkspace).not.toContain("mirrorQueuedCommands");
  expect(voiceWorkspace).not.toContain("sameConnections(");
  expect(ownerWorkspaceRuntime).toContain("supervisor.replaceConnections(initialProfiles)");
  const browserWorkspaceStyles = readFileSync(
    new URL("../../src/features/browser/BrowserWorkspace.styles.ts", import.meta.url),
    "utf8",
  );
  expect(browserWorkspaceStyles).toContain("backgroundColor: colors.errorContainer");
  const composerDeliveryMenu = readFileSync(
    new URL("../../src/features/composer/ComposerDeliveryMenu.native.tsx", import.meta.url),
    "utf8",
  );
  expect(composerDeliveryMenu).toContain("onLongPress: (event) =>");
  expect(composerDeliveryMenu).toContain("setExpanded(true)");
  const resourceContextStyles = readFileSync(
    new URL("../../src/ui/ResourceContextChip.styles.ts", import.meta.url),
    "utf8",
  );
  const composerContextText = sourceObjectDeclaration(resourceContextStyles, "composerContextText");
  expect(composerContextText).toContain("flexGrow: 0");
  expect(composerContextText).toContain("flexShrink: 0");
  expect(voiceWorkspace).not.toContain("const changedThreads = new Set<string>();");
  expect(privateAsset).toContain('source.kind === "path"');
  expect(privateAsset).toContain('source.kind === "content"');
  expect(privateAsset).toContain('companionUrl(access, "/v1/media/materialize")');
  expect(privateAsset).toContain("getAccess(attempt > 0)");
  expect(privateAsset).toContain("export async function readPrivateAssetText");
  expect(privateAsset).toContain("export async function fetchPrivateAsset");
  expect(privateAsset).toContain("export async function fetchScopedUpload");
  expect(fileTransferController).not.toContain("await options.getAccess()");
  const remoteWorkspace = readFileSync(
    new URL("../../src/data/workspace-runtime.ts", import.meta.url),
    "utf8",
  );
  expect(remoteWorkspace).not.toContain("LIVE_RENDER_BATCH_MS");
  expect(sessionOwner).toContain("const httpSessionMintInFlight = new Map");
  expect(sessionOwner).toMatch(
    /if\s*\(\s*!forceRefresh\s*&&\s*existingMint !== undefined\s*&&\s*existingMint\.credentialKey === credentialKey\s*\)/u,
  );
  expect(sessionOwner).toContain("if (forceRefresh)");
  expect(sessionOwner).toContain("httpSessions.delete(connection.id);");
  expect(privateAsset).toContain("getAccess(attempt > 0)");
  expect(remoteWorkspace).not.toContain("liveEventQueueRef");
  expect(remoteWorkspace).not.toContain("subscribeThreadEvents");
  expect(remoteWorkspace).not.toContain('session, "companion/threadWindow/read"');
  expect(remoteWorkspace).not.toContain("threadReadInFlightRef");
  expect(remoteWorkspace).not.toContain("lifecycleRepairAttempt");
  expect(remoteWorkspace).not.toContain("terminalThreadIds.has(threadId)");
});

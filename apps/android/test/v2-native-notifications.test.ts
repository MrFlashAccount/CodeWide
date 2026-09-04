import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connectionService = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/CodexConnectionService.kt",
    import.meta.url,
  ),
  "utf8",
);
const notificationProjection = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/V2NotificationProjection.kt",
    import.meta.url,
  ),
  "utf8",
);
const nativeModule = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt",
    import.meta.url,
  ),
  "utf8",
);
const savedServerRepository = readFileSync(
  new URL(
    "../src/v2/infrastructure/persistence/sqliteSavedServerRepository.native.ts",
    import.meta.url,
  ),
  "utf8",
);
const notificationStore = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/V2NotificationProjectionStore.kt",
    import.meta.url,
  ),
  "utf8",
);
const syncGenerationStore = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/NativeSyncGeneration.kt",
    import.meta.url,
  ),
  "utf8",
);
const syncSessionFactory = readFileSync(
  new URL("../src/v2/infrastructure/sync/createSyncSession.ts", import.meta.url),
  "utf8",
);
const pendingRequestsPanel = readFileSync(
  new URL("../src/v2/features/requests/PendingRequestsPanel.tsx", import.meta.url),
  "utf8",
);
const legacyRoute = readFileSync(new URL("../app/legacy.tsx", import.meta.url), "utf8");
const nativeTransport = readFileSync(
  new URL("../src/native/native-transport.native.ts", import.meta.url),
  "utf8",
);
const v2TerminalTransport = readFileSync(
  new URL("../src/v2/infrastructure/terminal/closedTerminalTransport.native.ts", import.meta.url),
  "utf8",
);

describe("V2 native notification authority", () => {
  it("observes the existing V2 sync channel without creating a second V2 runtime", () => {
    expect(connectionService).toContain('if (purpose != "sync-v2")');
    expect(connectionService).toContain("observeV2NotificationState(savedServerId, it)");
    expect(connectionService).toContain("foregroundV2SyncChannels.replace(savedServerId, channel)");
    expect(connectionService).not.toContain('openSocket("/v2/sync"');
  });

  it("suppresses legacy notification authority while V2 owns that saved server", () => {
    expect(connectionService).toContain("if (syncGeneration == NativeSyncGeneration.V2) return");
    expect(notificationProjection).toContain("SyncV2ContractGenerated.parseServerFrame(text)");
    expect(notificationProjection).toContain('"pendingRequestOpened"');
    expect(notificationProjection).toContain('"turnUpserted"');
  });

  it("never restores or connects legacy sync while V2 owns the native generation", () => {
    const onCreate = connectionService.slice(
      connectionService.indexOf("override fun onCreate()"),
      connectionService.indexOf("override fun onStartCommand("),
    );
    const activateV2 = connectionService.slice(
      connectionService.indexOf("internal fun activateV2Sync("),
      connectionService.indexOf("fun acknowledgeThrough("),
    );
    expect(onCreate).not.toContain("credentialsStore.list().filter");
    expect(onCreate).toContain(
      "if (syncGeneration == NativeSyncGeneration.V2) terminalSessionManager.deactivateGeneration()",
    );
    expect(activateV2).toContain('it.close("v2_generation_selected")');
    expect(activateV2).toContain("sessions.clear()");
    expect(activateV2).toContain(
      "terminalSessionManager.deactivateGeneration()\n      clearAllV2NotificationState()",
    );
    expect(activateV2).not.toContain("restoreLegacySync()");
    expect(nativeModule).toContain("action = CodexConnectionService.ACTION_ACTIVATE_V2");
    expect(savedServerRepository).toContain("setV2ConnectionEnabled");
    expect(savedServerRepository).not.toContain("wakeSocket");
    expect(savedServerRepository).not.toContain("resetSocket");
    expect(savedServerRepository).not.toContain("setConnectionEnabled(");
    const saveCredentials = nativeModule.slice(
      nativeModule.indexOf("private fun saveConnectionCredentials("),
      nativeModule.indexOf("@ReactMethod\n  fun listConnectionConfigs("),
    );
    expect(saveCredentials).not.toContain("ACTION_ATTACH");
    expect(saveCredentials).not.toContain("restoreLegacySync");
  });

  it("reclaims every legacy terminal before handing authority to V2", () => {
    const stopLegacy = connectionService.slice(
      connectionService.indexOf("internal fun stopLegacyRuntimeResources()"),
      connectionService.indexOf("internal fun listPortForwards("),
    );
    expect(legacyRoute).toContain("start: startLegacyNativeRuntimeResources");
    expect(legacyRoute).toContain("stop: stopLegacyNativeRuntimeResources");
    expect(nativeTransport).toContain("startLegacyRuntimeResources?: () => Promise<void>");
    expect(nativeTransport).toContain("stopLegacyRuntimeResources?: () => Promise<void>");
    expect(connectionService).toContain("internal fun activateLegacySync()");
    expect(stopLegacy).toContain("terminalSessionManager.deactivateGeneration()");
    expect(stopLegacy).not.toContain("authenticatedTransportLeases");
    expect(connectionService).toContain(
      "terminalSessionManager.activateGeneration()\n    restoreLegacySync()",
    );
    expect(v2TerminalTransport).toContain("acquireSharedConnectionLease");
    expect(v2TerminalTransport).not.toContain("NativeTerminalSessionManager");
  });

  it("pauses headless reconnect while offline and wakes immediately with network", () => {
    expect(connectionService).toContain("if (activeDefaultNetwork == null) return");
    expect(connectionService).toContain("stopAllHeadlessV2()");
    expect(connectionService).toContain("synchronized(this@CodexConnectionService)");
    expect(connectionService).toContain(
      "headlessV2ReconnectPolicy.nextDelay(savedServerId, activeDefaultNetwork != null)",
    );
    expect(connectionService).toContain("headlessV2ReconnectPolicy.resetAll()");
    expect(connectionService).toContain("restoreHeadlessV2()");
  });

  it("restores one service-owned V2 notification socket after headless recreation", () => {
    expect(connectionService).toContain("null -> restoreSelectedSyncGeneration()");
    expect(connectionService).toContain(
      "if (headlessV2Subscriptions.containsKey(savedServerId)) {",
    );
    expect(connectionService).toContain("if (foregroundV2SyncChannels.hasServer(savedServerId)) {");
    expect(connectionService).toContain(
      "headlessV2Subscriptions.putIfAbsent(savedServerId, subscription)",
    );
    expect(connectionService).toContain("stopHeadlessV2(savedServerId)");
    expect(connectionService.indexOf("stopHeadlessV2(savedServerId)")).toBeLessThan(
      connectionService.indexOf("foregroundV2SyncChannels.replace(savedServerId, channel)"),
    );
    expect(connectionService).toContain(
      'authenticatedTransportLeases.openDuplex(handle, channelId, "sync-v2")',
    );
    expect(connectionService).toContain('.put("pendingRequests", "allAccessible")');
    expect(connectionService).toContain('"snapshotCommitted"');
    expect(connectionService).toContain(
      "V2NotificationProjection(v2NotificationProjectionStore.read(savedServerId))",
    );
    expect(notificationStore).toContain(".commit()");
    expect(syncGenerationStore).toContain(".commit()");
    expect(connectionService).toContain("destroyed = true");
    expect(connectionService).toContain("if (destroyed) return");
  });

  it("fairly rotates headless authority when enabled servers exceed native capacity", () => {
    expect(connectionService).toContain("V2HeadlessFairScheduler(MAX_HEADLESS_V2_SUBSCRIPTIONS)");
    expect(connectionService).toContain("private const val MAX_HEADLESS_V2_SUBSCRIPTIONS = 63");
    expect(connectionService).toContain("runHeadlessV2FairnessCycle()");
    expect(connectionService).toContain("headlessV2FairScheduler.markCapacityBlocked()");
    expect(connectionService).toContain(
      "headlessV2FairScheduler.enqueue(rotation.retiringServerId)",
    );
    expect(connectionService).toContain("v2AuthenticatedLeaseAdmission.acquire(savedServerId)");
    expect(connectionService).toContain("@Synchronized\n  internal fun acquireAuthenticatedTransportLease");
    expect(connectionService).toContain("synchronized(this@CodexConnectionService)");
  });

  it("requests all approvals on the one foreground socket but scopes UI to its watched thread", () => {
    expect(syncSessionFactory).toContain('pendingRequests: "allAccessible"');
    expect(pendingRequestsPanel).toContain(
      "pendingRequests.filter((request) => request.threadId === threadId)",
    );
  });

  it("retires stale approval notifications with their V2 authority", () => {
    expect(connectionService).toContain("clearV2NotificationState(connectionId)");
    expect(connectionService).toContain("clearV2NotificationState(savedServerId)");
    expect(connectionService).toContain("clearAllV2NotificationState()\n      syncGeneration");
    expect(connectionService).toContain("projection?.closePendingRequests()?.forEach");
    expect(connectionService).toContain(
      "pendingApprovals.forEach { cancelApprovalNotification(id, it) }",
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConnectionProfileDatabase } from "../src/data/connection-profile-database.web";
import { createConnectionStateModel } from "../src/data/connection-state-model";
import type { StoredConnection } from "../src/data/connection-profile-types";
import { composerUploads } from "../src/data/composer-uploads";
import {
  createGlobalSupervisorBindingOwner,
  parseGlobalSupervisorBinding,
} from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorBindingDatabase } from "../src/data/globalSupervisorBindingDatabase.web";
import { createConnectionsWorkspaceAdapter } from "../src/features/connections/workspaceAdapter";
import * as native from "../src/native/native-transport";

const remote = vi.hoisted(() => ({ revoke: vi.fn(async () => undefined) }));

vi.mock("expo-crypto", () => ({ randomUUID: () => "unused" }));
vi.mock("react-native", () => ({
  Platform: { OS: "android", Version: 36 },
  PermissionsAndroid: {},
}));
vi.mock("../src/native/native-transport", () => ({
  claimNativePairing: vi.fn(),
  deleteNativeConnection: vi.fn(async () => undefined),
  listNativeConnectionConfigs: vi.fn(),
  reconnectNativeConnection: vi.fn(),
  revokeRemoteConnection: remote.revoke,
  saveNativeConnectionCredentials: vi.fn(),
  setNativeConnectionEnabled: vi.fn(),
  wakeNativeConnection: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe.each(["ready", "creating", "otherHome"] as const)(
  "saved server removal with %s assistant binding",
  (bindingStatus) => {
    it.each(["offline", "unreachable", "reachable"] as const)(
      "attempts device revocation for a %s server without delaying local removal",
      async (availability) => {
        const revoke = remote.revoke;
        const pendingRevocation = Promise.withResolvers<void>();
        revoke.mockReset();
        if (availability === "offline")
          revoke.mockRejectedValue(new Error("Companion unavailable"));
        else if (availability === "unreachable") revoke.mockReturnValue(pendingRevocation.promise);
        else revoke.mockResolvedValue(undefined);
        const profiles = createConnectionProfileDatabase();
        let saved: StoredConnection[] = ["removed", "kept"].map((id) => ({
          displayName: id,
          enabled: availability !== "offline",
          endpoint: "wss://example.test/v1/sync",
          iconId: "desktop",
          id,
          lastError: null,
          lastErrorAt: null,
          sortOrder: 0,
          state: availability === "reachable" ? "live" : "offline",
          token: "",
        }));
        vi.spyOn(profiles, "delete").mockImplementation(async (id) => {
          saved = saved.filter((profile) => profile.id !== id);
        });
        vi.spyOn(profiles, "hydrate").mockImplementation(async () => saved);
        const state = createConnectionStateModel();
        state.reconcileProfiles(
          saved.map((profile) => ({
            connectionId: profile.id,
            enabled: profile.enabled,
            id: profile.id,
          })),
        );
        const stop = vi.fn();
        const uploads = vi.spyOn(composerUploads, "deleteConnection");
        const deleteLocalConnectionData = vi.fn(async () => undefined);
        const forgetProjectCatalog = vi.fn(async () => undefined);
        const forgetHttpAuthorization = vi.fn();
        const forgetObservedThread = vi.fn();
        const invalidateCatalog = vi.fn();
        const bindingDatabase = createGlobalSupervisorBindingDatabase();
        const bindingConnectionId = bindingStatus === "otherHome" ? "kept" : "removed";
        const initialBinding = parseGlobalSupervisorBinding(
          bindingStatus === "creating"
            ? {
                homeConnectionId: bindingConnectionId,
                creationToken: "token",
                schemaVersion: 1,
                status: "creating",
              }
            : {
                home: { connectionId: bindingConnectionId, threadId: "assistant" },
                schemaVersion: 1,
                status: "ready",
              },
        );
        if (initialBinding === null) throw new Error("Invalid assistant fixture");
        await bindingDatabase.write(initialBinding);
        const bindingRemote = {
          findThreadsBySource: vi.fn(async () => []),
          readThreadSource: vi.fn(async () => null),
          startThread: vi.fn(async () => "unrequested"),
        };
        const binding = createGlobalSupervisorBindingOwner({
          database: bindingDatabase,
          randomUUID: () => "unused",
          remote: bindingRemote,
        });
        const invalidateDeletedConnectionBindings = vi.fn(async () => {
          await binding.invalidateDeletedConnections(new Set(saved.map((profile) => profile.id)));
        });
        const adapter = createConnectionsWorkspaceAdapter({
          closeCatalogWindows: vi.fn(),
          currentConnections: () => saved,
          deleteLocalConnectionData,
          forgetHttpAuthorization,
          forgetObservedThread,
          forgetProjectCatalog,
          getConnectionState: () => state,
          getProfiles: () => profiles,
          getSession: () => (availability === "offline" ? undefined : { rpc: vi.fn(), stop }),
          invalidateCatalog,
          invalidateDeletedConnectionBindings,
        });

        await expect(adapter.deleteConnection("removed")).resolves.toBeUndefined();

        expect(revoke).toHaveBeenCalledExactlyOnceWith("removed");
        expect(native.deleteNativeConnection).toHaveBeenCalledWith("removed");
        // Native credentials must still exist when the revocation request starts.
        const deletionOrder = vi.mocked(native.deleteNativeConnection).mock.invocationCallOrder[0];
        if (deletionOrder === undefined)
          throw new Error("Local credential deletion was not called");
        expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(deletionOrder);
        expect(saved.map((profile) => profile.id)).toEqual(["kept"]);
        expect(state.rows$.peek().map((row) => row.connectionId)).toEqual(["kept"]);
        for (const cleanup of [
          uploads,
          deleteLocalConnectionData,
          forgetProjectCatalog,
          forgetHttpAuthorization,
          forgetObservedThread,
          invalidateCatalog,
        ]) {
          expect(cleanup).toHaveBeenCalledExactlyOnceWith("removed");
        }
        expect(stop).toHaveBeenCalledTimes(availability === "offline" ? 0 : 1);
        expect(invalidateDeletedConnectionBindings).toHaveBeenCalledOnce();
        await expect(binding.read()).resolves.toEqual(
          bindingStatus === "otherHome"
            ? initialBinding
            : {
                priorHome: initialBinding.status === "ready" ? initialBinding.home : null,
                reason: "homeDeleted",
                schemaVersion: 1,
                status: "invalid",
              },
        );
        for (const rpc of Object.values(bindingRemote)) expect(rpc).not.toHaveBeenCalled();
        if (availability === "unreachable") {
          // A delayed remote failure cannot fail or undo completed local deletion.
          pendingRevocation.reject(new Error("Companion request timed out"));
          await Promise.resolve();
          expect(saved.map((profile) => profile.id)).toEqual(["kept"]);
        }
        profiles.close();
        state.close();
      },
    );
  },
);

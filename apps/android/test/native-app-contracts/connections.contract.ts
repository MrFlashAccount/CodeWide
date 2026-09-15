import { expect, it } from "vitest";
import { connectionAdapter, connectionProjection } from "./connections-sources";
import { ownerWorkspaceOverlays } from "./workspace-sources";

it("never consumes a one-time pairing token before local profiles are ready", () => {
  const addConnectionStart = connectionAdapter.indexOf("const addConnection = async");
  const addConnectionEnd = connectionAdapter.indexOf(
    "const deleteConnection = async",
    addConnectionStart,
  );
  const addConnection = connectionAdapter.slice(addConnectionStart, addConnectionEnd);
  expect(addConnectionStart).toBeGreaterThanOrEqual(0);
  expect(addConnectionEnd).toBeGreaterThan(addConnectionStart);
  expect(
    addConnection.indexOf("requireConnectionProfileDatabase(getProfiles())"),
  ).toBeGreaterThanOrEqual(0);
  expect(addConnection.indexOf("claimNativePairing")).toBeGreaterThanOrEqual(0);
  expect(addConnection.indexOf("requireConnectionProfileDatabase(getProfiles())")).toBeLessThan(
    addConnection.indexOf("claimNativePairing"),
  );
  expect(addConnection.indexOf("const connectionId = `saved-server-${randomUUID()}`")).toBeLessThan(
    addConnection.indexOf("claimNativePairing"),
  );
  expect(addConnection).toContain("savedServerId: connectionId");
  expect(addConnection).not.toContain("deleteNativeConnection(connectionId)");
  expect(addConnection).toContain("profiles.reconcileRuntimeConfigs(nativeConfigs)");
  expect(ownerWorkspaceOverlays).toContain("localReady={runtime.ready && runtime.error === null}");
});

it("preserves connections integration contracts", () => {
  expect(connectionProjection).toContain("useLiveQuery(");
});

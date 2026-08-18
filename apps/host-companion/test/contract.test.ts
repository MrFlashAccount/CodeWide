import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { DEFAULT_DEVICE_SCOPES, DEVICE_SCOPES } from "../src/capabilities.js";
import { exposedRpcMethods } from "../src/rpc-policy.js";
import { THREAD_READ_MODEL_VERSION } from "../src/sync-hub.js";
import { PUBLIC_BUILD_SHELF_PATHS } from "../src/server.js";
import { THREAD_PATCH_FIELD, THREAD_PATCH_OPERATIONS, THREAD_PATCH_VERSION } from "../src/thread-patch.js";

type V1Contract = {
  protocolVersion: number;
  threadReadModelVersion: number;
  webSocketPaths: string[];
  httpRoutes: string[];
  deviceScopes: string[];
  defaultDeviceScopes: string[];
  rpcMethods: string[];
  publicBuildShelfPaths: string[];
  threadProjectionPatch: {
    field: string;
    version: number;
    operations: unknown[];
  };
};

const contractPath = new URL("../contract/v1.json", import.meta.url);

describe("frozen V1 companion contract", () => {
  it("matches the Node policy and authorization surfaces", async () => {
    const contract = JSON.parse(await readFile(contractPath, "utf8")) as V1Contract;
    expect(contract.protocolVersion).toBe(1);
    expect(contract.threadReadModelVersion).toBe(THREAD_READ_MODEL_VERSION);
    expect(contract.webSocketPaths).toEqual(["/v1/app-server", "/v1/sync"]);
    expect(contract.httpRoutes).toContain("GET /healthz");
    expect(contract.deviceScopes).toEqual([...DEVICE_SCOPES].sort());
    expect(contract.defaultDeviceScopes).toEqual([...DEFAULT_DEVICE_SCOPES].sort());
    expect(contract.rpcMethods).toEqual(exposedRpcMethods());
    expect(contract.publicBuildShelfPaths).toEqual(PUBLIC_BUILD_SHELF_PATHS);
    expect(contract.threadProjectionPatch).toEqual({
      field: THREAD_PATCH_FIELD,
      version: THREAD_PATCH_VERSION,
      operations: THREAD_PATCH_OPERATIONS,
    });
  });
});

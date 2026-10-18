import { describe, expect, it } from "vitest";

import * as syncClient from "../src/index";

describe("sync-client public surface", () => {
  it("no longer ships a JavaScript wire client", () => {
    // The Companion closes a hello without interest; the Android native engine
    // is the only wire client.
    expect(Object.keys(syncClient)).not.toContain("SyncSession");
    expect(Object.keys(syncClient)).not.toContain("MultiConnectionSupervisor");
  });

  it("keeps the RPC error contract", () => {
    const error = new syncClient.RpcResponseError(-32_601, "Method not found");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RpcResponseError");
    expect(error.code).toBe(-32_601);
    expect(error.message).toBe("Method not found");
  });
});

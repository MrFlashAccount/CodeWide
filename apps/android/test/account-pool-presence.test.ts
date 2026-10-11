import { describe, expect, it } from "vitest";

import { accountPoolPresence } from "../src/data/agentProviders";

describe("account pool presence", () => {
  it("keeps the pool of an older Companion however it fails the provider list", () => {
    expect(accountPoolPresence({ status: "unsupported" })).toEqual({ kind: "present", owner: null });
    expect(accountPoolPresence({ error: "unknown method", status: "error", value: null })).toEqual({
      kind: "present",
      owner: null,
    });
    // Not known yet: the pool waits for the first answer.
    expect(accountPoolPresence({ status: "idle" })).toEqual({ kind: "pending" });
    expect(accountPoolPresence({ status: "loading", value: null })).toEqual({ kind: "pending" });
  });
});

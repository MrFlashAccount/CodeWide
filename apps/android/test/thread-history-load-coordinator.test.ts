import { describe, expect, it } from "vitest";

import { ThreadHistoryLoadCoordinator } from "../src/data/thread-history-load-coordinator";

describe("thread history load coordinator", () => {
  it("stays pending until every independently coalesced direction settles", () => {
    const coordinator = new ThreadHistoryLoadCoordinator();

    expect(coordinator.begin("older")).toBe(true);
    expect(coordinator.begin("latest")).toBe(false);
    expect(coordinator.succeed("latest")).toEqual({ status: "pending" });
    expect(coordinator.succeed("older")).toEqual({ status: "ready" });
  });

  it("retains a failure until the remaining concurrent request settles", () => {
    const coordinator = new ThreadHistoryLoadCoordinator();
    const cause = new Error("older page failed");

    coordinator.begin("older");
    coordinator.begin("latest");
    expect(coordinator.fail("older", cause)).toEqual({ status: "pending" });
    expect(coordinator.succeed("latest")).toEqual({ status: "failed", cause });
  });
});

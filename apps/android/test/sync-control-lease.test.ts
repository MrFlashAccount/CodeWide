import { describe, expect, it } from "vitest";

import { createSyncControlLease } from "../src/data/sync-control-lease";

describe("sync control lease", () => {
  it("does not let stale cleanup clear a replacement live writer", () => {
    const lease = createSyncControlLease<object>();
    const first = {};
    const second = {};
    const releaseFirst = lease.install(first);
    const releaseSecond = lease.install(second);

    releaseFirst();
    expect(lease.get()).toBe(second);

    releaseSecond();
    expect(lease.get()).toBeNull();
  });
});

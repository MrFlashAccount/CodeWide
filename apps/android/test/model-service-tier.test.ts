import { describe, expect, it } from "vitest";

import { fastServiceTier, isFastServiceTier, retainedServiceTier, STANDARD_SERVICE_TIER } from "../src/ui/modelServiceTier";

describe("Fast service tier catalog", () => {
  const tier = { id: "priority", name: "Fast" };

  it("uses the catalog id rather than the deprecated speed-tier label", () => {
    expect(fastServiceTier([tier])?.id).toBe("priority");
    expect(isFastServiceTier("priority", tier)).toBe(true);
    expect(isFastServiceTier("fast", tier)).toBe(true);
    expect(isFastServiceTier(STANDARD_SERVICE_TIER, tier)).toBe(false);
    expect(retainedServiceTier("fast", [tier])).toBe("priority");
    expect(retainedServiceTier(STANDARD_SERVICE_TIER, [])).toBe(STANDARD_SERVICE_TIER);
    expect(retainedServiceTier("priority", [])).toBeUndefined();
  });
});

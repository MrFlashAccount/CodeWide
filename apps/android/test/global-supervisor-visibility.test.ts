import { describe, expect, it } from "vitest";
import { isCatalogExcluded, catalogExcludedThreadIds } from "../src/data/threadCatalogMembership";

describe("server-owned catalog membership", () => {
  it("does not infer exclusions from a source, title, or local binding", () => {
    expect(
      isCatalogExcluded({ threadSource: "codewide-global-supervisor:token", name: "Assistant" }),
    ).toBe(false);
    expect(isCatalogExcluded({ codewideCatalogExcluded: false })).toBe(false);
    expect(isCatalogExcluded({ codewideCatalogExcluded: true })).toBe(true);
  });
  it("validates server removal instructions", () => {
    expect(catalogExcludedThreadIds({ excludedThreadIds: ["a", "b"] })).toEqual(["a", "b"]);
    expect(() => catalogExcludedThreadIds({ excludedThreadIds: [null] })).toThrow();
    expect(() => isCatalogExcluded({ codewideCatalogExcluded: "true" })).toThrow();
  });
});

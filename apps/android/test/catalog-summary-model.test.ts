import { describe, expect, it } from "vitest";
import { CatalogSummaryModel, parseArchivedCatalogCount } from "../src/data/catalog-summary-model";

describe("server-owned catalog totals", () => {
  it("distinguishes missing metadata from a confirmed empty archive", () => {
    for (const value of [null, undefined, {}, { archivedCount: -1 }, { archivedCount: 1.5 }, { archivedCount: "80" }, { archivedCount: Infinity }]) {
      expect(parseArchivedCatalogCount(value)).toBeNull();
    }
    expect(parseArchivedCatalogCount({ archivedCount: 0 })).toBe(0);
    expect(parseArchivedCatalogCount({ archivedCount: 80 })).toBe(80);
  });

  it("aggregates only known servers and fences responses predating archive changes", () => {
    const model = new CatalogSummaryModel();
    const before = model.revision("a");
    expect(model.count(["a"])).toBeNull();
    model.publish("a", before, 80);
    expect(model.count(["a"])).toBe(80);
    expect(model.count(["a", "b"])).toBeNull();
    model.publish("b", model.revision("b"), 2);
    expect(model.count(["a", "b"])).toBe(82);
    model.invalidate("a");
    model.publish("a", before, 80);
    expect(model.count(["a"])).toBeNull();
    model.publish("a", model.revision("a"), 81);
    expect(model.count(["a", "b"])).toBe(83);
  });
});

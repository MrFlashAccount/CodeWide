import { describe, expect, it } from "vitest";

import {
  readReleaseDelivery,
  readReleaseProducts,
  releaseTag,
} from "../../../scripts/release-product-contract";
import { nextDatedReleaseTag, releaseDate } from "../../../scripts/release-set-identity";

function product(id: string) {
  return {
    id,
    version: "0.5.0",
    sourceRevision: "a".repeat(40),
    sourceTag: "release-2026-09-30.1",
    assets: [{ name: `${id}.bin`, sha256: "b".repeat(64), size: 10 }],
  };
}

describe("release inventory boundary", () => {
  it("accepts dated and historical origins independently of product version", () => {
    expect(releaseTag("v0.4.0")).toBe("v0.4.0");
    expect(readReleaseDelivery({ delivery: "reuse", ...product("macos") })).toMatchObject({
      delivery: "reuse",
      version: "0.5.0",
      sourceTag: "release-2026-09-30.1",
    });
    expect(
      readReleaseProducts({
        products: ["relay", "companion-linux", "macos", "android-apk"].map(product),
      }),
    ).toHaveLength(4);
  });

  it("rejects missing, duplicate or malformed product provenance", () => {
    expect(() => readReleaseProducts({ products: [product("relay")] })).toThrow(
      "all four products",
    );
    expect(() =>
      readReleaseProducts({ products: ["relay", "relay", "macos", "android-apk"].map(product) }),
    ).toThrow("all four products");
    expect(() =>
      readReleaseDelivery({ delivery: "reuse", ...product("macos"), sourceRevision: "HEAD" }),
    ).toThrow("full Git SHA");
    expect(() =>
      readReleaseDelivery({
        delivery: "reuse",
        ...product("macos"),
        assets: [{ name: "../secret", sha256: "b".repeat(64), size: 1 }],
      }),
    ).toThrow("Unsafe release asset name");
    expect(() =>
      readReleaseDelivery({
        delivery: "reuse",
        ...product("macos"),
        assets: [{ name: "app.dmg", sha256: "wrong", size: 1 }],
      }),
    ).toThrow("digest");
    expect(() => releaseTag("release-2026-09-30.0")).toThrow();
  });
});

describe("dated release identity", () => {
  it("reserves the next ordinal across published tags and failed drafts", () => {
    expect(
      nextDatedReleaseTag("2026-09-30", [
        "v0.5.0",
        "release-2026-09-29.9",
        "release-2026-09-30.2",
        "release-2026-09-30.10",
      ]),
    ).toBe("release-2026-09-30.11");
    expect(nextDatedReleaseTag("2026-10-01", [])).toBe("release-2026-10-01.1");
  });

  it("rejects an impossible calendar date", () => {
    expect(() => releaseDate("2026-02-29")).toThrow();
    expect(() => releaseDate("2026-13-01")).toThrow();
    expect(releaseDate("2028-02-29")).toBe("2028-02-29");
  });
});

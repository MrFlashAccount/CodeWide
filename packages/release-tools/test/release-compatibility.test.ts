import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateCompatibility } from "../../../scripts/validate-release-compatibility";

const compatibility: unknown = JSON.parse(
  readFileSync(new URL("../../../release/compatibility.json", import.meta.url), "utf8"),
);

describe("release compatibility", () => {
  it("keeps every declared delivery link protocol-compatible", () => {
    expect(() => validateCompatibility(
      compatibility,
      (path) => path.endsWith("pairing.json") ? 4 : 1,
    )).not.toThrow();
  });

  it("rejects provider and consumer ranges without an intersection", () => {
    const incompatible = {
      schemaVersion: 1,
      interfaces: { sync: { versions: [1, 2] } },
      products: {
        server: { provides: { sync: [2] }, requires: {} },
        client: { provides: {}, requires: { sync: [1] } },
      },
      links: [{ provider: "server", consumer: "client", interface: "sync" }],
    };
    expect(() => validateCompatibility(incompatible, () => 1)).toThrow(/no compatible sync version/u);
  });
});

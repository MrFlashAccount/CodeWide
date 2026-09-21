import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const android = fileURLToPath(new URL("../", import.meta.url));

describe("V1-only application entry", () => {
  it("publishes only V1 routes and the public compatibility aliases", () => {
    const routes = readdirSync(join(android, "app"), { withFileTypes: true });
    expect(routes.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).toEqual([
      "v1",
    ]);
    for (const alias of ["index", "legacy", "pair", "thread"]) {
      const route = readFileSync(join(android, "app", `${alias}.tsx`), "utf8");
      expect(route).toContain('href="/v1"');
      expect(route).not.toContain("Generation");
    }
  });

  it("cannot load the retired UI through a stored preference or diagnostics host", () => {
    const root = readFileSync(join(android, "app/_layout.tsx"), "utf8");
    const workspace = readFileSync(join(android, "app/v1/_layout.tsx"), "utf8");
    for (const source of [root, workspace]) {
      expect(source).not.toMatch(/UiGeneration|uiGeneration|V2Application|src\/v2\//u);
    }
    expect(root).toContain("<AppLockGate>");
    expect(root).toContain("<NavigationPerformanceHud />");
    expect(existsSync(join(android, "src/v2/V2Application.tsx"))).toBe(false);
  });
});

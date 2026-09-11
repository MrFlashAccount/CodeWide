import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("preserves the React View style contract for animated bubble surfaces", () => {
  const source = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeFluidLayoutManager.kt", import.meta.url), "utf8");
  // ViewGroupManager only handles base props. ReactViewManager owns rounded
  // backgrounds, per-corner radii, borders and overflow used by Bubble's ViewProps.
  expect(source).toContain("NativeFluidLayoutManager : ReactViewManager()");
});

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps row content in a single UI runtime instead of nesting RN accessory hosts", () => {
  const android = readFileSync(
    new URL("../src/ui/AppListRow.android.tsx", import.meta.url),
    "utf8",
  );
  const nativeContent = readFileSync(
    new URL("../src/ui/AppListRowContent.tsx", import.meta.url),
    "utf8",
  );
  // Explicit performance boundary: Compose rows must not embed RN slots, and
  // custom content uses the shared RN row without creating any Compose host.
  expect(android).not.toContain("RNHostView");
  expect(nativeContent).not.toContain("@expo/ui");
  expect(android.match(/<Host\b/gu)).toHaveLength(1);
});

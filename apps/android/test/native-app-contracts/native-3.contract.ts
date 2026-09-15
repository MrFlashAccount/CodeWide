import { expect, it } from "vitest";
import { gradle } from "./native-sources";

it("preserves native integration contracts — 3", () => {
  expect(gradle).toContain('applicationIdSuffix ".dev"');
  expect(gradle).toContain('resValue "string", "app_name", "CodeWide Dev"');
});

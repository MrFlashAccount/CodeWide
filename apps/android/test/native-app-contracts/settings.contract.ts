import { expect, it } from "vitest";
import { sourceHasJsxElement } from "../source-contract";
import { settingsSheet } from "./settings-sources";

it("preserves settings integration contracts", () => {
  expect(
    sourceHasJsxElement(settingsSheet, "AppSheet", [
      'contentContainerClassName: "h-full"',
      "enableDynamicSizing: false",
      "enableOverDrag: false",
      'snapPoints: ["65%", "90%"]',
    ]),
  ).toBe(true);
});

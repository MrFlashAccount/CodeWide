import { expect, it } from "vitest";
import { settingsSheet } from "./settings-sources";

it("preserves settings integration contracts", () => {
  expect(settingsSheet).toContain(
    "snapPoints: [\"65%\", \"90%\"],\n        enableDynamicSizing: false,\n        enableOverDrag: false,\n        contentContainerClassName: \"h-full\"",
  );
});

import { expect, it } from "vitest";
import { navigationActions } from "./navigation-sources";

it("preserves navigation integration contracts", () => {
  expect(navigationActions).not.toContain("preloadWindow");
  expect(navigationActions).toContain(
    "KeyboardController.dismiss({ animated: false, keepFocus: false })",
  );
});

import { expect, it } from "vitest";
import {
  threadServerSelection,
  conversationNavigation,
  navigationActions,
} from "./navigation-sources";

it("preserves navigation integration contracts", () => {
  expect(threadServerSelection).toMatch(/const defaultDesktopThreadId =\s*desktop/);
  expect(threadServerSelection).toMatch(/\?\s*threadSelectionKey\(serverThreads\[0\]\)/);
  expect(conversationNavigation).toContain("threadNavigation.select(defaultDesktopThreadId)");
  expect(navigationActions).toContain("remote.threadDetails.preloadWindow({");
  expect(navigationActions).toContain(
    "KeyboardController.dismiss({ animated: false, keepFocus: false })",
  );
});

import { expect, it } from "vitest";
import {
  threadServerSelection,
  conversationNavigation,
  navigationActions,
} from "./navigation-sources";

it("preserves navigation integration contracts", () => {
  expect(threadServerSelection).toContain(
    "const defaultDesktopThreadId = defaultDesktopThreadSelection(",
  );
  expect(conversationNavigation).toContain("revision={defaultThread}");
  expect(conversationNavigation).toMatch(
    /onCommit=\{\(\) => \{\s*list\.selectThread\(defaultThread\);\s*\}\}/u,
  );
  expect(navigationActions).toContain("remote.threadDetails.preloadWindow({");
  expect(navigationActions).toContain(
    "KeyboardController.dismiss({ animated: false, keepFocus: false })",
  );
});

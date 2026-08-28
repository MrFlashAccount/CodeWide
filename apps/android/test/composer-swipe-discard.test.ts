import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const swipeActionSource = readFileSync(fileURLToPath(new URL("../src/ui/SwipeDiscardAction.tsx", import.meta.url)), "utf8");
const workspaceSource = readFileSync(fileURLToPath(new URL("../src/CodeWideScreen.tsx", import.meta.url)), "utf8");

describe("composer swipe discard", () => {
  it("arms only on a deliberate left drag and gives one medium haptic per gesture", () => {
    expect(swipeActionSource).toContain(".activeOffsetX([-8, 100_000])");
    expect(swipeActionSource).toContain("next <= -distance + DISCARD_ARM_RADIUS");
    expect(swipeActionSource).toContain("!hapticPlayed.get()");
    expect(swipeActionSource).toContain("Haptics.ImpactFeedbackStyle.Medium");
    expect(swipeActionSource).toContain("if (armed.get()) runOnJS(discard)()");
  });

  it("keeps discard on the primary action and removes the visible clear buttons", () => {
    expect(workspaceSource).toContain("<SwipeDiscardAction");
    expect(workspaceSource).toContain("onDiscard={discardComposer}");
    expect(workspaceSource).not.toContain('accessibilityLabel="Clear message"');
    expect(workspaceSource).not.toContain("composerInlineAction");
    expect(workspaceSource).not.toContain("composerErrorDismiss");
  });
});

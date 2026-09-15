import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { COMPOSER_SWIPE_THRESHOLD, COMPOSER_SWIPE_TARGET, composerSwipeArmed, composerSwipeDirection, composerSwipeTravel } from "../src/ui/composer-swipe";
import { sourceObjectDeclaration } from "./source-contract";

const swipeActionSource = readFileSync(fileURLToPath(new URL("../src/ui/SwipeDiscardAction.tsx", import.meta.url)), "utf8");
const workspaceSource = readFileSync(fileURLToPath(new URL("../src/features/composer/ComposerFeature.tsx", import.meta.url)), "utf8");

const ownerComposerSubmitAction = readFileSync(new URL("../src/features/composer/ComposerSubmitAction.tsx", import.meta.url), "utf8");

const composerStyles=readFileSync(new URL("../src/features/composer/ComposerFeature.styles.ts",import.meta.url),"utf8");
const submitAction=readFileSync(new URL("../src/features/composer/ComposerSubmitAction.tsx",import.meta.url),"utf8");
const editor=readFileSync(new URL("../src/features/composer/ComposerEditor.tsx",import.meta.url),"utf8");
const microphone=readFileSync(new URL("../src/features/composer/ComposerMicrophone.tsx",import.meta.url),"utf8");

describe("composer swipe discard", () => {
  it("places the accessory menu before text inside the common composer surface", () => {
    const composer = workspaceSource.slice(workspaceSource.indexOf('<View testID="composer-row"'));
    const shell = composer.indexOf('testID="composer-input-shell"');
    const menu = composer.indexOf("{props.useAnchoredComposerMenu ? (");
    const input = composer.indexOf("<ComposerEditor");
    const voice = composer.indexOf("<ComposerMicrophone");
    const send = composer.indexOf("<ComposerSubmitAction");
    expect(shell).toBeGreaterThan(0);
    expect(menu).toBeGreaterThan(shell);
    expect(input).toBeGreaterThan(menu);
    expect(voice).toBeGreaterThan(input);
    expect(send).toBeGreaterThan(voice);
    expect(editor).toContain('accessibilityLabel="Message Codex"');
    expect(microphone).toContain("ref={microphoneButtonRef}");
    expect(submitAction).toContain("<ComposerDeliveryMenu");
    const menuStyle = sourceObjectDeclaration(composerStyles, "composerMenu").replace(/\s+/gu, " ");
    expect(menuStyle).not.toContain("backgroundColor");
    expect(menuStyle).toContain("width: touchTarget, height: touchTarget");
  });

  it("recognizes left discard and upward steer, not right or downward swipes", () => {
    expect(composerSwipeDirection(-30, -10)).toBe("discard");
    expect(composerSwipeDirection(-10, -30)).toBe("steer");
    expect(composerSwipeDirection(30, -10)).toBe("none");
    expect(composerSwipeDirection(-10, 30)).toBe("none");
    expect(composerSwipeDirection(0, 0)).toBe("none");
  });

  it("requires deliberate travel and lets the user retract before releasing", () => {
    expect(composerSwipeArmed(0)).toBe(false);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD - 1)).toBe(false);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD)).toBe(true);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD + 20)).toBe(true);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD - 10)).toBe(false);
    expect(composerSwipeArmed(-100)).toBe(false);
  });

  it("keeps visual travel short, continuous and increasingly resistant beyond the threshold", () => {
    const threshold = COMPOSER_SWIPE_THRESHOLD;
    expect(composerSwipeTravel(-100)).toBe(0);
    expect(composerSwipeTravel(0)).toBe(0);
    expect(composerSwipeTravel(threshold)).toBe(COMPOSER_SWIPE_TARGET);
    expect(composerSwipeTravel(threshold + 0.001) - composerSwipeTravel(threshold)).toBeLessThan(0.001);
    const first = composerSwipeTravel(threshold + 20) - composerSwipeTravel(threshold);
    const second = composerSwipeTravel(threshold + 40) - composerSwipeTravel(threshold + 20);
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(0);
    expect(composerSwipeTravel(10_000)).toBeLessThan(threshold);
  });

  it("gives one light threshold haptic and dispatches an armed action only on release", () => {
    expect(swipeActionSource).toContain("!hapticPlayed.get()");
    expect(swipeActionSource).toContain("Haptics.ImpactFeedbackStyle.Light");
    const release = swipeActionSource.slice(swipeActionSource.indexOf(".onEnd("), swipeActionSource.indexOf(".onFinalize("));
    expect(release).toContain("if (!success || !armed.get()) return");
    expect(release).toContain('direction.get() === "discard" && discardEnabled');
    expect(release).toContain('direction.get() === "steer" && steerEnabled && !disabled');
    expect(release).toContain("runOnJS(discard)()");
    expect(release).toContain("runOnJS(steer)()");
    const cancellation = swipeActionSource.slice(swipeActionSource.indexOf(".onFinalize("));
    expect(cancellation).not.toContain("runOnJS");
    expect(cancellation).toContain("withSpring(0");
  });

  it("keeps the moving button outside the Compose trigger and unclipped by the input", () => {
    const menu = readFileSync(new URL("../src/features/composer/ComposerDeliveryMenu.native.tsx", import.meta.url), "utf8");
    expect(menu.indexOf("cloneElement(props.children")).toBeGreaterThan(menu.indexOf("</CodeWideMenu>"));
    for (const owner of ["composer", "composerInputShell"]) {
      const style = sourceObjectDeclaration(composerStyles, owner);
      expect(style).toContain('overflow: "visible"');
    }
    expect(workspaceSource).not.toContain("swipeDiscardDistanceForWidth");
    expect(submitAction).not.toContain("swipeDiscardDistanceForWidth");
    expect(ownerComposerSubmitAction).toContain("onSteer={steerComposer}");
    expect(ownerComposerSubmitAction).toContain("onPress={activatePrimaryAction}");
  });

  it("keeps discard on the primary action and removes the visible clear buttons", () => {
    expect(ownerComposerSubmitAction).toContain("<SwipeDiscardAction");
    expect(ownerComposerSubmitAction).toContain("onDiscard={discardComposer}");
    expect(workspaceSource).not.toContain('accessibilityLabel="Clear message"');
    expect(workspaceSource).not.toContain("composerInlineAction");
    expect(workspaceSource).not.toContain("composerErrorDismiss");
  });
});

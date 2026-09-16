import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { sourceHasJsxElement } from "./source-contract";

const context = readFileSync(
  new URL("../src/ui/OverlaySurfaceContext.tsx", import.meta.url),
  "utf8",
);
const appSheet = readFileSync(new URL("../src/ui/AppSheet.tsx", import.meta.url), "utf8");
const fullscreenModal = readFileSync(
  new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url),
  "utf8",
);
const actionMenu = readFileSync(
  new URL("../src/ui/ActionMenu.native.tsx", import.meta.url),
  "utf8",
);

describe("overlay surface ownership", () => {
  it("marks only content hosted by a native bottom sheet", () => {
    expect(context).toContain(
      'const ROOT_OVERLAY_SURFACE: OverlaySurfaceContextValue = { surface: "root" }',
    );
    expect(
      sourceHasJsxElement(appSheet, "OverlaySurfaceProvider", ['surface="native-sheet"']),
    ).toBe(true);
  });

  it("lets Expo UI own menu popups inside native sheet surfaces", () => {
    expect(appSheet).not.toContain("PortalHost");
    expect(appSheet).not.toContain("measureInWindow");
    expect(appSheet).not.toContain("useWindowDimensions");
    expect(actionMenu).toContain('from "./CodeWideMenu.native"');
    expect(actionMenu).toContain("expanded={isOpen}");
    expect(actionMenu).toContain("{triggerElement}");
    expect(actionMenu).not.toContain("heroui-native/menu");
    expect(actionMenu).not.toContain("useOverlaySurface");
    expect(actionMenu).not.toContain("Menu.Portal");
    expect(actionMenu).not.toContain("requestAnimationFrame");
  });

  it("marks the native fullscreen modal window without a second portal tree", () => {
    expect(context).toContain(
      'export type OverlaySurface = "root" | "native-sheet" | "fullscreen-modal"',
    );
    expect(
      sourceHasJsxElement(fullscreenModal, "OverlaySurfaceProvider", [
        'surface="fullscreen-modal"',
      ]),
    ).toBe(true);
    expect(fullscreenModal).not.toContain("PortalHost");
  });

  it("does not reintroduce cross-window z-index workarounds", () => {
    expect(context).not.toMatch(/zIndex|elevation/u);
    expect(appSheet).not.toMatch(/zIndex|elevation/u);
    expect(fullscreenModal).not.toMatch(/zIndex|elevation/u);
    expect(actionMenu).not.toMatch(/zIndex|elevation/u);
  });
});

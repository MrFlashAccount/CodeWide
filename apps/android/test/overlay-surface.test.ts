import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const context = readFileSync(new URL("../src/ui/OverlaySurfaceContext.tsx", import.meta.url), "utf8");
const appSheet = readFileSync(new URL("../src/ui/AppSheet.tsx", import.meta.url), "utf8");
const fullscreenModal = readFileSync(new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url), "utf8");
const actionMenu = readFileSync(new URL("../src/ui/ActionMenu.native.tsx", import.meta.url), "utf8");

describe("overlay surface ownership", () => {
  it("marks only content hosted by a native bottom sheet", () => {
    expect(context).toContain('const ROOT_OVERLAY_SURFACE: OverlaySurfaceContextValue = { surface: "root" }');
    expect(appSheet).toContain('<OverlaySurfaceProvider surface="native-sheet" portalHostName={portalHostName}>');
    expect(appSheet.indexOf('<OverlaySurfaceProvider surface="native-sheet" portalHostName={portalHostName}>')).toBeLessThan(
      appSheet.indexOf("{children}"),
    );
  });

  it("keeps one HeroUI menu system inside native sheet surfaces", () => {
    expect(appSheet).toContain('import { PortalHost } from "heroui-native/portal"');
    expect(appSheet).toContain("const portalHostName = `app-sheet-${useId()}`");
    expect(appSheet).toContain("<PortalHost name={portalHostName} />");
    expect(appSheet).not.toContain("measureInWindow");
    expect(appSheet).not.toContain("useWindowDimensions");
    expect(actionMenu).toContain("const { portalHostName } = useOverlaySurface()");
    expect(actionMenu).toContain("<Menu.Portal {...(portalHostName === undefined ? {} : { hostName: portalHostName })}>");
    expect(actionMenu).not.toContain("NativeSheetActionMenu");
    expect(actionMenu).not.toContain("MenuView");
    expect(actionMenu).not.toContain("@expo/ui/community/menu");
  });

  it("hosts menu portals inside the native fullscreen modal window", () => {
    expect(context).toContain('export type OverlaySurface = "root" | "native-sheet" | "fullscreen-modal"');
    expect(fullscreenModal).toContain('import { PortalHost } from "heroui-native/portal"');
    expect(fullscreenModal).toContain("const portalHostName = `fullscreen-modal-${useId()}`");
    expect(fullscreenModal).toContain('<OverlaySurfaceProvider surface="fullscreen-modal" portalHostName={portalHostName}>');
    expect(fullscreenModal.indexOf('<OverlaySurfaceProvider surface="fullscreen-modal" portalHostName={portalHostName}>')).toBeLessThan(
      fullscreenModal.indexOf("{children}"),
    );
    expect(fullscreenModal).toContain("<PortalHost name={portalHostName} />");
  });

  it("does not reintroduce cross-window z-index workarounds", () => {
    expect(context).not.toMatch(/zIndex|elevation/u);
    expect(appSheet).not.toMatch(/zIndex|elevation/u);
    expect(fullscreenModal).not.toMatch(/zIndex|elevation/u);
    expect(actionMenu).not.toMatch(/zIndex|elevation/u);
  });
});

import { expect, it } from "vitest";
import {
  ownerAgentsRoute,
  ownerBrowserRoute,
  ownerDraftContentRoute,
  ownerDraftDocumentRoute,
  ownerDrawingRoute,
  ownerNewServerRoute,
  ownerNewThreadLayout,
  ownerNewThreadRoute,
  ownerChangesRoute,
  ownerFullscreenRouteOverlay,
  ownerSettingsRoute,
  ownerThreadContentRoute,
  ownerThreadDocumentRoute,
  ownerTerminalRoute,
  ownerTurnChangesRoute,
  ownerWorkspaceComposition,
  ownerWorkspaceLayout,
  ownerWorkspaceStyles,
  ownerUseWindowLayout,
  ownerWorkspaceThreadList,
  ownerThreadRouteLayout,
} from "./workspace-sources";

it("preserves workspace integration contracts", () => {
  expect(ownerNewServerRoute).toContain("<ConnectionSheet");
  expect(ownerSettingsRoute).toContain("<SubscribedConnectionSettings");
  expect(ownerNewThreadRoute).toContain("<ActiveWorkspaceConversation");
  expect(ownerNewThreadRoute).not.toContain("NewThreadServerSheet");
  expect(ownerWorkspaceLayout).toMatch(
    /<WorkspaceVoiceAura(?=[^>]*controller=\{workspaceRuntime\.voiceController\})(?=[^>]*resources=\{resources\.runtime\.resources\})[^>]*>/u,
  );
  expect(ownerWorkspaceComposition).toContain("const windowLayout = useWindowLayout()");
  expect(ownerUseWindowLayout).toContain("windowLayoutStore.subscribe");
  expect(ownerUseWindowLayout).toContain("windowLayoutStore.getSnapshot");
  expect(ownerWorkspaceComposition).toContain("viewportWidth: windowLayout.width");
  expect(ownerWorkspaceThreadList).toContain("width: desktopThreadSidebarWidth(viewportWidth)");
  // The browser is a transparent sheet whose grip alone owns dragging.
  expect(ownerWorkspaceLayout).toContain(
    '<Stack.Screen name="browser/[sessionId]" options={v1BrowserScreenOptions} />',
  );
  expect(ownerWorkspaceStyles).toMatch(
    /export const v1BrowserScreenOptions = \{\s*\.\.\.v1SheetScreenOptions,\s*gestureEnabled: false,\s*\} as const;/u,
  );
  // Both Add project entry routes present the directory picker as a sheet
  // over Manage Projects, not as an opaque destination.
  expect(ownerWorkspaceLayout).toContain(
    '<Stack.Screen name="projects/add/[connectionId]" options={v1SheetScreenOptions} />',
  );
  expect(ownerWorkspaceLayout).toContain(
    '<Stack.Screen name="projects/add/index" options={v1SheetScreenOptions} />',
  );
  expect(ownerWorkspaceLayout).toContain(
    '<Stack.Screen name="drawing/[sessionId]" options={v1FullscreenScreenOptions} />',
  );
  expect(ownerThreadRouteLayout).toContain(
    '<Stack.Screen name="changes/index" options={v1FullscreenScreenOptions} />',
  );
  expect(ownerThreadRouteLayout).toContain(
    '<Stack.Screen name="documents/[sessionId]" options={v1FullscreenScreenOptions} />',
  );
  expect(ownerThreadRouteLayout).toContain(
    '<Stack.Screen name="terminal" options={v1FullscreenScreenOptions} />',
  );
  expect(ownerNewThreadLayout).toContain(
    '<Stack.Screen name="documents/[sessionId]" options={v1FullscreenScreenOptions} />',
  );
  expect(ownerWorkspaceStyles).toMatch(
    /export const v1FullscreenScreenOptions = \{(?=[^}]*backgroundColor: colors\.threadListSurface)[\s\S]*?presentation: "transparentModal",\n\} as const;/u,
  );
  expect(ownerWorkspaceStyles).not.toContain('presentation: "fullScreenModal"');
  expect(ownerWorkspaceStyles).toContain('animation: "fade"');
  expect(ownerWorkspaceStyles).toContain('animation: "fade_from_bottom"');
  expect(ownerWorkspaceStyles).toContain("import { v1MobileRouteMotion } from");
  expect(ownerWorkspaceStyles).toContain("animationDuration: v1MobileRouteMotion.durationMs");
  expect(ownerWorkspaceLayout).toContain("useReducedMotionPreference()");
  expect(ownerWorkspaceLayout).toMatch(
    /reducedMotion\s*\? v1RouteScreenOptions\s*:\s*desktop\s*\? v1DesktopRouteScreenOptions\s*:\s*v1MobileRouteScreenOptions/u,
  );
  expect(ownerFullscreenRouteOverlay).toContain("useAppFullscreenOverlay({ lifecycle, scope })");
  expect(ownerFullscreenRouteOverlay).toContain("present(({ close }) =>");
  expect(ownerDrawingRoute).toContain("<RouteFullscreenOverlay");
  // The browser route only publishes its session to the shell-resident
  // BrowserWorkspaceHost, which keeps tab catalogs alive across dismissal.
  expect(ownerBrowserRoute).not.toContain("<RouteFullscreenOverlay");
  expect(ownerBrowserRoute).toContain("browserPresentation.show({");
  expect(ownerBrowserRoute).toContain("browserPresentation.hide(session.id)");
  expect(ownerWorkspaceLayout).toContain("<BrowserWorkspaceHost");
  for (const conversationFullscreenRoute of [
    ownerAgentsRoute,
    ownerChangesRoute,
    ownerTurnChangesRoute,
    ownerThreadContentRoute,
    ownerThreadDocumentRoute,
    ownerTerminalRoute,
    ownerDraftContentRoute,
    ownerDraftDocumentRoute,
  ]) {
    expect(conversationFullscreenRoute).toContain("<ConversationRouteFullscreenOverlay");
  }
});

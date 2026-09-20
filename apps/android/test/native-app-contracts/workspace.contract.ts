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
  expect(ownerNewThreadRoute).toContain("<NewThreadServerSheet");
  expect(ownerWorkspaceLayout).toMatch(
    /<WorkspaceVoiceAura(?=[^>]*controller=\{workspaceRuntime\.voiceController\})(?=[^>]*resources=\{resources\.runtime\.resources\})[^>]*>/u,
  );
  expect(ownerWorkspaceComposition).toContain("const windowLayout = useWindowLayout()");
  expect(ownerUseWindowLayout).toContain("windowLayoutStore.subscribe");
  expect(ownerUseWindowLayout).toContain("windowLayoutStore.getSnapshot");
  expect(ownerWorkspaceComposition).toContain("viewportWidth={windowLayout.width}");
  expect(ownerWorkspaceThreadList).toContain("width: desktopThreadSidebarWidth(viewportWidth)");
  expect(ownerWorkspaceLayout).toContain(
    '<Stack.Screen name="browser/[sessionId]" options={v1FullscreenScreenOptions} />',
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
  expect(ownerThreadRouteLayout).toMatch(
    /visibility === null \|\|\s*!visibility\.allowsOrdinaryRef/u,
  );
  expect(ownerThreadRouteLayout).toContain("useWorkspaceRuntime();");
  expect(ownerNewThreadLayout).toContain(
    '<Stack.Screen name="documents/[sessionId]" options={v1FullscreenScreenOptions} />',
  );
  expect(ownerWorkspaceStyles).toMatch(
    /export const v1FullscreenScreenOptions = \{(?=[^}]*backgroundColor: colors\.threadListSurface)[\s\S]*?presentation: "transparentModal",\n\} as const;/u,
  );
  expect(ownerWorkspaceStyles).not.toContain('presentation: "fullScreenModal"');
  expect(ownerWorkspaceStyles).toContain('animation: "fade"');
  expect(ownerWorkspaceStyles).toContain('animation: "fade_from_bottom"');
  expect(ownerWorkspaceStyles).toContain('import { v1MobileRouteMotion } from');
  expect(ownerWorkspaceStyles).toContain("animationDuration: v1MobileRouteMotion.durationMs");
  expect(ownerWorkspaceLayout).toContain("useReducedMotionPreference()");
  expect(ownerWorkspaceLayout).toMatch(
    /reducedMotion\s*\? v1RouteScreenOptions\s*:\s*desktop\s*\? v1DesktopRouteScreenOptions\s*:\s*v1MobileRouteScreenOptions/u,
  );
  expect(ownerFullscreenRouteOverlay).toContain("useAppFullscreenOverlay({ lifecycle, scope })");
  expect(ownerFullscreenRouteOverlay).toContain("present(({ close }) =>");
  for (const fullscreenRoute of [ownerBrowserRoute, ownerDrawingRoute]) {
    expect(fullscreenRoute).toContain("<RouteFullscreenOverlay");
  }
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

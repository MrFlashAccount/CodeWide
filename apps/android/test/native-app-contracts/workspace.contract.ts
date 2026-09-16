import { expect, it } from "vitest";
import {
  ownerNewServerRoute,
  ownerNewThreadRoute,
  ownerSettingsRoute,
  ownerWorkspaceComposition,
  ownerWorkspaceLayout,
  ownerUseWindowLayout,
  ownerWorkspaceThreadList,
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
});

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  ownerWorkspaceOverlays,
  ownerWorkspaceScreen,
  ownerUseWindowLayout,
  ownerWorkspaceThreadList,
} from "./workspace-sources";

const workspaceView = readFileSync(new URL("../../src/features/workspace/WorkspaceScreenContent.tsx", import.meta.url), "utf8");

it("preserves workspace integration contracts", () => {
  expect(ownerWorkspaceOverlays).toMatch(
    /\{connectionActions\.connectionSheetVisible && \(\s*<ConnectionSheet/u,
  );
  expect(ownerWorkspaceOverlays).toMatch(
    /\{settingsVisible && \(\s*<SubscribedConnectionSettings/u,
  );
  expect(ownerWorkspaceOverlays).toMatch(/\{newThreadVisible && \(\s*<NewThreadServerSheet/u);
  expect(workspaceView).toMatch(
    /<WorkspaceVoiceAura\s+resources=\{props\.runtime\.resources\}\s+controller=\{workspaceRuntime\.voiceController\}\s*>/u,
  );
  expect(ownerWorkspaceScreen).toContain("const windowLayout = useWindowLayout()");
  expect(ownerUseWindowLayout).toContain("windowLayoutStore.subscribe");
  expect(ownerUseWindowLayout).toContain("windowLayoutStore.getSnapshot");
  expect(ownerWorkspaceScreen).toContain("viewportWidth={windowLayout.width}");
  expect(ownerWorkspaceThreadList).toContain("width: desktopThreadSidebarWidth(viewportWidth)");
});

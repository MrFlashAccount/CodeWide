import { expect, it } from "vitest";
import {
  turnWorkspaceAdapter,
  threadHeaderView,
  turnActionsAdapter,
  migratedThreadHeaderActions,
} from "./turnActions-sources";

it("preserves turnActions integration contracts", () => {
  expect(turnWorkspaceAdapter).toContain(
    'rpcAfterAttach(session, "turn/interrupt", { threadId, turnId })',
  );
  expect(threadHeaderView).toContain("contentProps={{ index: 0, enableDynamicSizing: true }}");
  expect(turnWorkspaceAdapter).toContain(".updateArchived(connectionId, threadId, true)");
  expect(turnActionsAdapter).toMatch(
    /\.updateArchived\(\s*connectionId,\s*threadId,\s*false,?\s*\)/u,
  );
  expect(migratedThreadHeaderActions).toContain('icon: "pencil-outline"');
  expect(migratedThreadHeaderActions).toMatch(/\{\s*id: "compact",\s*label: "Compact context"/);
  expect(migratedThreadHeaderActions).toContain("const actions: ActionMenuItem[] = [");
  expect(threadHeaderView).toContain("onSelect={handleAction}");
});

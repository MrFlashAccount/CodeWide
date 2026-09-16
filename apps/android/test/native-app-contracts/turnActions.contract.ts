import { expect, it } from "vitest";
import { sourceHasJsxElement } from "../source-contract";
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
  expect(
    sourceHasJsxElement(threadHeaderView, "AppSheet", [
      "contentProps={{",
      "enableDynamicSizing: true",
      "index: 0",
    ]),
  ).toBe(true);
  expect(turnWorkspaceAdapter).toContain(".updateArchived(connectionId, threadId, true)");
  expect(turnActionsAdapter).toMatch(
    /\.updateArchived\(\s*connectionId,\s*threadId,\s*false,?\s*\)/u,
  );
  expect(migratedThreadHeaderActions).toContain('icon: "pencil-outline"');
  expect(migratedThreadHeaderActions).toMatch(
    /\{(?=[^}]*id: "compact")(?=[^}]*label: "Compact context")[^}]*\}/u,
  );
  expect(migratedThreadHeaderActions).toContain("const actions: ActionMenuItem[] = [");
  expect(threadHeaderView).toContain("onSelect={handleAction}");
});

import { expect, it } from "vitest";
import { mainConversationHeader } from "./conversation-header-sources";
import { threadRowActions, threadRow, threadRowWebMenu } from "./threadList-sources";
import { migratedThreadHeaderActions, copySession } from "./turnActions-sources";

it("copies the real session id from both thread action menus", () => {
  expect(mainConversationHeader).toContain("threadId={thread.id}");
  expect(threadRowActions).toContain('id: "copy-session-id"');
  expect(threadRowActions).toContain('label: "Copy session ID"');
  expect(threadRowActions).toContain('icon: "copy-outline"');
  for (const menu of [threadRow, threadRowWebMenu])
    expect(menu).toContain("copySessionId(thread.id, showNotice)");
  expect(migratedThreadHeaderActions).toContain("copySessionId(threadId, showNotice)");
  expect(copySession).toContain('showNotice({ label: "Session ID copied" })');
});

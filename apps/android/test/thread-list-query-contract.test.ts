import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
const database = readFileSync(new URL("../src/data/thread-summary-sqlite.native.ts", import.meta.url), "utf8");

const listWorkspace = compactSource(readFileSync(new URL("../src/features/threadList/threadListWorkspace.ts", import.meta.url), "utf8"));

const navigationActions = compactSource(readFileSync(new URL("../src/features/navigation/conversationNavigationActions.ts", import.meta.url), "utf8"));

const serverSelection = compactSource(readFileSync(new URL("../src/features/navigation/serverSelection.ts", import.meta.url), "utf8"));

const ownerConversationWorkspace = compactSource(readFileSync(new URL("../src/features/conversation/ConversationWorkspace.tsx", import.meta.url), "utf8"));

const ownerConversationDestinationSurface = compactSource(readFileSync(new URL("../src/features/conversation/ConversationDestinationSurface.tsx", import.meta.url), "utf8"));
const ownerActiveConversationScope = compactSource(readFileSync(new URL("../src/features/conversation/activeConversationScope.ts", import.meta.url), "utf8"));

describe("thread list query contract", () => {
  it("loads all pinned roots separately from the bounded recent page", () => {
    expect(listWorkspace).toContain("const threadSummaryView = useThreadSummaryView(");
    const pinnedQuery = database.slice(database.indexOf("const pinned ="), database.indexOf("const recent ="));
    expect(pinnedQuery).not.toContain("LIMIT");
    expect(database).toContain("archived = 0 AND pinned = 0${connectionClause} ORDER BY recency_at DESC NULLS LAST, __key ASC LIMIT ?");
    // The remote page includes pinned roots even though SQLite renders them separately.
    expect(listWorkspace).toContain(": recentThreadSummaryRows.length + pinnedThreadSummaryRows.length;");
  });

  it("indexes every persisted field used to select the bounded root windows", () => {
    for (const field of ["connection_id", "pinned", "archived", "parent_thread_id", "delete_command_id", "recency_at"]) {
      expect(database).toContain(field);
    }
  });

  it("uses SQL null semantics for every queryable nullable column", () => {
    expect(database).toContain("parent_thread_id IS NULL");
    expect(database).toContain("delete_command_id IS NULL");
    expect(database).toContain("parent_thread_id IS NOT NULL");
  });

  it("keeps the cached catalog across projection-only schema upgrades", () => {
    expect(database).toContain("const SCHEMA_VERSION = 5");
    expect(database).not.toContain("DROP TABLE IF EXISTS");
  });

  it("does not order SQLite subsets by text columns", () => {
    expect(database).not.toContain("ORDER BY thread_id");
  });

  it("commits the initial desktop conversation by stable id before Recent can reorder", () => {
    expect(serverSelection).toContain("const defaultDesktopThreadId = desktop");
    expect(serverSelection).toContain("? threadSelectionKey(serverThreads[0])");
    expect(navigationActions).toContain("threadNavigation.select(defaultDesktopThreadId)");
    expect(ownerConversationDestinationSurface).toContain("scope=\"desktop-default-thread\"");
    expect(ownerConversationDestinationSurface).toContain("revision={props.destination.kind === \"empty\" ? props.defaultDesktopThreadId : null}");
    expect(navigationActions).toContain('threadNavigation.destination$.peek().kind !== "empty"');
    expect(ownerConversationDestinationSurface).toContain("onCommit={props.scope.commitDefaultDesktopThread}");
    expect(ownerActiveConversationScope).toContain("? selectedThread : null;");
    expect(screen).not.toContain("selectedThread ?? (desktop && !pendingThreadSelection");
  });
});

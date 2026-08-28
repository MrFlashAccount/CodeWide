import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const database = readFileSync(new URL("../src/data/thread-summary-sqlite.native.ts", import.meta.url), "utf8");

describe("thread list query contract", () => {
  it("loads all pinned roots separately from the bounded recent page", () => {
    expect(screen).toContain("const threadSummaryView = useThreadSummaryView(");
    const pinnedQuery = database.slice(database.indexOf("const pinned ="), database.indexOf("const recent ="));
    expect(pinnedQuery).not.toContain("LIMIT");
    expect(database).toContain("archived = 0 AND pinned = 0${connectionClause} ORDER BY recency_at DESC NULLS LAST, __key ASC LIMIT ?");
    expect(screen).toContain(": recentThreadSummaryRows.length;");
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
    expect(screen).toContain("threadNavigation.current().id === null && serverThreads[0] !== undefined");
    expect(screen).toContain("const defaultThreadId = threadSelectionKey(serverThreads[0])");
    expect(screen).toContain("threadNavigation.select(defaultThreadId)");
    expect(screen).toContain("? selectedThread\n    : null;");
    expect(screen).not.toContain("selectedThread ?? (desktop && !pendingThreadSelection");
  });
});

import type { V2ThreadSummary } from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { presentThreadListRow } from "../src/v2/features/threadList/threadListRow";
import {
  threadArchiveCommand,
  threadMarkReadCommand,
} from "../src/v2/features/threadList/threadListCommands";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { threadMatchesFilter } from "../src/v2/presentation/navigation/threadListModel";
import {
  resolveThreadListRowAction,
  threadListRowPreview,
  threadListRowActionMenu,
} from "../src/v2/presentation/navigation/threadListRowModel";
import type {
  ThreadListRow,
  ThreadListRowActions,
} from "../src/v2/presentation/navigation/threadListTypes";

describe("V2 thread list behavior", () => {
  it("derives unread state only from the authoritative thread projection", () => {
    const row = presentThreadListRow({
      pinned: false,
      retained: false,
      thread: thread({
        kind: "unread",
        latestActivityMarker: "activity-7",
        readThroughMarker: "activity-4",
        unreadCount: 3,
      }),
    });

    expect(row).toMatchObject({ latestActivityMarker: "activity-7", unread: 3 });
    expect(threadMatchesFilter(row, "unread")).toBe(true);
  });

  it("does not invent unread state when authority reports unknown", () => {
    const row = presentThreadListRow({
      pinned: false,
      retained: true,
      thread: thread({
        kind: "unknown",
        latestActivityMarker: "activity-7",
        readThroughMarker: null,
        unreadCount: null,
      }),
    });

    expect(row).toMatchObject({ latestActivityMarker: null, unread: 0 });
    expect(threadMatchesFilter(row, "unread")).toBe(false);
  });

  it("marks read through the exact rendered marker", async () => {
    const actions = actionSpies();
    const operation = resolveThreadListRowAction(actions, row(), "markRead");

    await operation?.();

    expect(actions.markRead).toHaveBeenCalledWith("thread-1", "activity-7");
  });

  it("passes desired pin and archive state instead of mutating the row", async () => {
    const actions = actionSpies();
    const current = row();

    await resolveThreadListRowAction(actions, current, "togglePin")?.();
    await resolveThreadListRowAction(actions, current, "archive")?.();

    expect(actions.togglePin).toHaveBeenCalledWith("thread-1", true);
    expect(actions.archive).toHaveBeenCalledWith("thread-1", true);
    expect(current).toMatchObject({ archived: false, pinned: false });
  });

  it("builds idempotent authoritative archive and read commands", () => {
    const owner = qualifiedThread(savedServerId("server-1"), threadId("thread-1"));

    expect(threadArchiveCommand(owner, true)).toEqual({
      change: { archived: true, kind: "archive" },
      kind: "thread.update",
      threadId: "thread-1",
    });
    expect(threadMarkReadCommand(owner, "activity-7")).toEqual({
      kind: "thread.markRead",
      threadId: "thread-1",
      throughActivityMarker: "activity-7",
    });
  });

  it("blocks remote actions for retained rows while keeping local actions available", () => {
    const actions = actionSpies();
    const retained = { ...row(), retained: true };

    expect(resolveThreadListRowAction(actions, retained, "archive")).toBeNull();
    expect(resolveThreadListRowAction(actions, retained, "markRead")).toBeNull();
    expect(resolveThreadListRowAction(actions, retained, "copy")).not.toBeNull();
    expect(resolveThreadListRowAction(actions, retained, "togglePin")).not.toBeNull();
    expect(
      threadListRowActionMenu(retained, false).map((item) => [item.id, item.disabled]),
    ).toEqual([
      ["copy", false],
      ["togglePin", false],
      ["markRead", true],
      ["archive", true],
    ]);
  });

  it("preserves normal previews and uses the V1 source fallback only without one", () => {
    expect(threadListRowPreview({ ...row(), retained: true })).toBe("Preview");
    expect(threadListRowPreview(row())).toBe("Preview");
    expect(threadListRowPreview({ ...row(), preview: undefined, retained: true })).toBe("Cached");
    expect(threadListRowPreview({ ...row(), preview: undefined })).toBe("Live");
  });
});

function actionSpies(): ThreadListRowActions {
  return {
    archive: vi.fn(() => Promise.resolve()),
    copyId: vi.fn(() => Promise.resolve()),
    markRead: vi.fn(() => Promise.resolve()),
    togglePin: vi.fn(() => Promise.resolve()),
  };
}

function row(): ThreadListRow {
  return {
    archived: false,
    id: "thread-1",
    latestActivityMarker: "activity-7",
    pinned: false,
    preview: "Preview",
    retained: false,
    state: "completed",
    title: "Thread",
    unread: 3,
    updatedAt: "12:00",
  };
}

function thread(readState: V2ThreadSummary["readState"]): V2ThreadSummary {
  return {
    archived: false,
    createdAt: "2026-09-01T00:00:00Z",
    headTurnId: null,
    id: "thread-1",
    lastActivityAt: "2026-09-01T00:00:00Z",
    parentId: null,
    preview: "Preview",
    readState,
    settings: null,
    state: "completed",
    title: "Thread",
    updatedAt: "2026-09-01T00:00:00Z",
    workspace: "/workspace",
  };
}

import type { SidebarProject } from "../projects/sidebarProjects";

export type SidebarRow<Thread> =
  | { kind: "header"; title: "Pinned chats" | "Pinned projects" | "Recent" }
  | { kind: "project"; project: SidebarProject }
  | { kind: "thread"; thread: Thread };

/** Section order stays stable; pinned chats only get a heading when present. */
export function sidebarRows<Thread extends { pinned: boolean }>(
  threads: readonly Thread[],
  projects: readonly SidebarProject[],
  scope: "global" | "project" | "archive",
): SidebarRow<Thread>[] {
  const rows: SidebarRow<Thread>[] = [];
  if (scope === "global") {
    rows.push({ kind: "header", title: "Pinned projects" });
    for (const project of projects) {
      rows.push({ kind: "project", project });
    }
  }
  if (threads.some((thread) => thread.pinned)) {
    rows.push({ kind: "header", title: "Pinned chats" });
  }
  for (const thread of threads) {
    if (thread.pinned) {
      rows.push({ kind: "thread", thread });
    }
  }
  if (scope !== "archive") {
    rows.push({ kind: "header", title: "Recent" });
  }
  for (const thread of threads) {
    if (!thread.pinned) {
      rows.push({ kind: "thread", thread });
    }
  }
  return rows;
}

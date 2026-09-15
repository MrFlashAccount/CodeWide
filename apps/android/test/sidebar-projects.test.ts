import { describe, expect, it } from "vitest";
import { ProjectUnreadModel, projectScopeKey } from "../src/data/project-unread-model";
import { sidebarProjects } from "../src/features/projects/sidebarProjects";
import { sidebarRows } from "../src/features/threadList/sidebarRows";
import {
  projectThreadSummaryView,
  createThreadSummaryModel,
  type ThreadSummaryViewRequest,
} from "../src/data/thread-summary-model";
import { summary } from "./fixtures/thread-summary";

const request: ThreadSummaryViewRequest = {
  viewId: "project",
  connectionId: "server",
  projectCwd: "/repo",
  recentLimit: 2,
  archivedLimit: 2,
  selectedConnectionId: null,
  selectedThreadId: null,
  subagentConnectionId: null,
  subagentLimit: 0,
};

describe("sidebar project navigation", () => {
  it("keeps section order without an empty pinned-chat heading", () => {
    expect(sidebarRows([], [], "global")).toEqual([
      { kind: "header", title: "Pinned projects" },
      { kind: "header", title: "Recent" },
    ]);
    const projects = sidebarProjects(
      { server: [{ path: "/repo", name: "Repo", addedAt: 1, lastUsedAt: 1, pinned: true }] },
      [{ id: "server", name: "Buddy" }],
      [],
    );
    const rows = sidebarRows(
      [summary("recent"), summary("pinned", { pinned: true })],
      projects,
      "global",
    );
    expect(
      rows.map((row) =>
        row.kind === "header"
          ? row.title
          : row.kind === "project"
            ? row.project.name
            : row.thread.name,
      ),
    ).toEqual(["Pinned projects", "Repo", "Pinned chats", "pinned", "Recent", "recent"]);
    expect(sidebarRows([summary("archived", { archived: true })], projects, "archive")).toEqual([
      { kind: "thread", thread: summary("archived", { archived: true }) },
    ]);
    expect(sidebarRows([], projects, "project").some((row) => row.kind === "project")).toBe(false);
  });

  it.each(["global", "project", "archive"] as const)(
    "shows pinned chats in %s only while there are matching chats",
    (scope) => {
      const ordinary = summary("ordinary", { archived: scope === "archive" });
      const pinned = summary("pinned", { pinned: true, archived: scope === "archive" });
      expect(
        sidebarRows([ordinary], [], scope).some(
          (row) => row.kind === "header" && row.title === "Pinned chats",
        ),
      ).toBe(false);
      const pinnedStart = scope === "global" ? 1 : 0;
      expect(
        sidebarRows([ordinary, pinned], [], scope).slice(pinnedStart, pinnedStart + 2),
      ).toEqual([
        { kind: "header", title: "Pinned chats" },
        { kind: "thread", thread: pinned },
      ]);
      expect(
        sidebarRows([{ ...pinned, pinned: false }], [], scope).some(
          (row) => row.kind === "header" && row.title === "Pinned chats",
        ),
      ).toBe(false);
    },
  );

  it("does not reorder projects with activity or merge names across servers", () => {
    const first = { path: "/one", name: "Repo", addedAt: 1, lastUsedAt: 1, pinned: true };
    const second = { path: "/two", name: "Repo", addedAt: 2, lastUsedAt: 100, pinned: false };
    const servers = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ];
    const projects = sidebarProjects({ a: [second, first], b: [first] }, servers, [
      projectScopeKey("b", "/one"),
    ]);
    expect(
      projects.map(({ connectionId, path, unread, pinned }) => ({
        connectionId,
        path,
        unread,
        pinned,
      })),
    ).toEqual([
      { connectionId: "a", path: "/one", unread: false, pinned: true },
      { connectionId: "a", path: "/two", unread: false, pinned: false },
      { connectionId: "b", path: "/one", unread: true, pinned: true },
    ]);
    expect(projects[0]?.subtitle).toContain("Alpha");
    expect(projects[2]?.subtitle).toContain("Beta");
    expect(projects[0]?.serverLabel).toBe("Alpha");
    expect(projects[2]?.serverLabel).toBe("Beta");
    expect(
      sidebarProjects({ a: [{ ...first, lastUsedAt: 1000 }, second], b: [first] }, servers, []).map(
        (p) => p.key,
      ),
    ).toEqual(projects.map((p) => p.key));
  });

  it("adds server labels only for colliding pinned names, not hidden projects", () => {
    const repo = { path: "/repo", name: "Repo", addedAt: 1, lastUsedAt: 1, pinned: true };
    const servers = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ];
    const unique = sidebarProjects({ a: [repo], b: [{ ...repo, pinned: false }] }, servers, []);
    expect(unique.find((project) => project.connectionId === "a")?.serverLabel).toBeNull();
    const duplicate = sidebarProjects({ a: [repo], b: [{ ...repo, name: "repo" }] }, servers, []);
    expect(duplicate.map((project) => project.serverLabel)).toEqual(["Alpha", "Beta"]);
    expect(duplicate.map((project) => project.path)).toEqual(["/repo", "/repo"]);
    const resolved = sidebarProjects(
      { a: [repo], b: [{ ...repo, name: "Another project" }] },
      servers,
      [],
    );
    expect(resolved.map((project) => project.serverLabel)).toEqual([null, null]);
  });

  it("filters exact project and server before paginating active and archived rows", () => {
    const result = projectThreadSummaryView(
      [
        ...Array.from({ length: 50 }, (_, i) =>
          summary(`other-${i}`, { cwd: "/elsewhere", recencyAt: 100 + i }),
        ),
        summary("other-server", { connectionId: "other", recencyAt: 999 }),
        summary("child-directory", { cwd: "/repo/child", recencyAt: 999 }),
        summary("subagent", { parentThreadId: "root" }),
        summary("pinned", { pinned: true }),
        summary("first", { recencyAt: 3 }),
        summary("second", { recencyAt: 2 }),
        summary("third"),
        summary("archived", { archived: true }),
        summary("other-archive", { archived: true, cwd: "/elsewhere" }),
      ],
      request,
    );
    expect(result.recent.map((row) => row.name)).toEqual(["first", "second"]);
    expect(result.pinned.map((row) => row.name)).toEqual(["pinned"]);
    expect(result.archived.map((row) => row.name)).toEqual(["archived"]);
  });

  it("live updates cannot leak a different project into an open list", async () => {
    const model = createThreadSummaryModel();
    const resource = model.resource(request, async () =>
      projectThreadSummaryView([summary("mine")], request),
    );
    await resource.ready$.peek();
    model.publish([{ type: "insert", value: summary("other", { cwd: "/other", recencyAt: 500 }) }]);
    expect(resource.view$.peek().recent.map((row) => row.name)).toEqual(["mine"]);
    model.publish([{ type: "update", value: summary("mine", { archived: true }) }]);
    expect(resource.view$.peek().recent).toEqual([]);
    expect(resource.view$.peek().archived.map((row) => row.name)).toEqual(["mine"]);
    model.close();
  });
});

describe("project unread membership", () => {
  it("spans off-page threads and remains until the last unread thread is read", async () => {
    const model = new ProjectUnreadModel();
    await model.resource(async () => [
      summary("old-unread", { unread: 1 }),
      summary("another", { unread: 1 }),
    ]);
    expect(model.projects$.peek()).toEqual([projectScopeKey("server", "/repo")]);
    model.publish([{ type: "update", value: summary("old-unread") }]);
    expect(model.projects$.peek()).toHaveLength(1);
    model.publish([{ type: "update", value: summary("another") }]);
    expect(model.projects$.peek()).toEqual([]);
    model.close();
  });

  it("does not resurrect unread state from a stale hydration result", async () => {
    const model = new ProjectUnreadModel();
    let resolve!: (rows: ReturnType<typeof summary>[]) => void;
    const loading = model.resource(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    model.publish([{ type: "update", value: summary("read-during-load") }]);
    resolve([summary("read-during-load", { unread: 1 })]);
    await loading;
    expect(model.projects$.peek()).toEqual([]);
    model.close();
  });

  it("excludes archives, subagents and pending deletion, and keeps servers independent", async () => {
    const model = new ProjectUnreadModel();
    await model.resource(async () => [
      summary("archived", { unread: 1, archived: true }),
      summary("agent", { unread: 1, parentThreadId: "root" }),
      summary("deleted", { unread: 1, deleteCommandId: "delete" }),
      summary("other", { unread: 1, connectionId: "other" }),
    ]);
    expect(model.projects$.peek()).toEqual([projectScopeKey("other", "/repo")]);
    model.publish([
      {
        type: "update",
        value: summary("other", { unread: 1, archived: true, connectionId: "other" }),
      },
    ]);
    expect(model.projects$.peek()).toEqual([]);
    model.close();
  });
});

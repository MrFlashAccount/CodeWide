import { describe, expect, it } from "vitest";

import { deriveThreadProjects, normalizeProjectCwd, projectIncludesCwd, projectLabel, threadContextLabel } from "../src/data/thread-projects";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

function summary(connectionId: string, cwd: string, updatedAt: number, gitOriginUrl: string | null = null): StoredThreadSummary {
  return {
    connectionId,
    remoteThreadId: `${connectionId}-${cwd}-${updatedAt}`,
    name: null,
    preview: "",
    cwd,
    gitOriginUrl,
    updatedAt,
    recencyAt: updatedAt,
    status: { type: "idle" },
    pinned: false,
    archived: false,
    pendingRequestCount: 0,
    latestActivityCursor: 0,
    lastSeenCursor: 0,
    unread: 0,
    provisionalThread: null,
    deleteCommandId: null,
  };
}

describe("thread projects", () => {
  it("deduplicates cwd per server and sorts by last use", () => {
    expect(deriveThreadProjects([
      summary("a", "/work/old", 1),
      summary("a", "/work/new", 3),
      summary("a", "/work/old", 4),
      summary("b", "/work/other", 9),
    ], "a")).toEqual([
      { cwd: "/work/old", cwds: ["/work/old"], label: "old", lastUsedAt: 4 },
      { cwd: "/work/new", cwds: ["/work/new"], label: "new", lastUsedAt: 3 },
    ]);
  });

  it("normalizes harmless path spelling differences before deduplication", () => {
    expect(deriveThreadProjects([
      summary("a", " /work//codewide/ ", 1),
      summary("a", "/work/codewide", 2),
    ], "a")).toEqual([
      { cwd: "/work/codewide", cwds: ["/work/codewide"], label: "codewide", lastUsedAt: 2 },
    ]);
    expect(normalizeProjectCwd("C:/work/codewide/")).toBe("C:\\work\\codewide");
  });

  it("folds Git worktrees into one logical project and prefers the durable checkout", () => {
    const origin = "https://github.com/example/example-project.git";
    const projects = deriveThreadProjects([
      summary("a", "/home/example-user/.codex/worktrees/123/example-project", 9, origin),
      summary("a", "/home/example-user/projects/example-project", 2, origin),
    ], "a");
    expect(projects).toEqual([{
      cwd: "/home/example-user/projects/example-project",
      cwds: [
        "/home/example-user/.codex/worktrees/123/example-project",
        "/home/example-user/projects/example-project",
      ],
      label: "example-project",
      lastUsedAt: 9,
    }]);
    expect(projectIncludesCwd(projects[0]!, "/home/example-user/.codex/worktrees/123/example-project/")).toBe(true);
  });

  it("keeps unrelated same-name directories separate and disambiguates their labels", () => {
    expect(deriveThreadProjects([
      summary("a", "/work/client/api", 2),
      summary("a", "/work/server/api", 1),
    ], "a")).toEqual([
      { cwd: "/work/client/api", cwds: ["/work/client/api"], label: "api · client", lastUsedAt: 2 },
      { cwd: "/work/server/api", cwds: ["/work/server/api"], label: "api · server", lastUsedAt: 1 },
    ]);
  });

  it("labels Unix and Windows working directories", () => {
    expect(projectLabel("/work/codewide/")).toBe("codewide");
    expect(projectLabel("C:\\work\\codewide")).toBe("codewide");
  });

  it("labels an open thread with its server and project", () => {
    expect(threadContextLabel("Workstation", "/work/codewide")).toBe("Workstation · codewide");
    expect(threadContextLabel("Workstation", "/work/codewide", "Mobile workspace")).toBe("Workstation · Mobile workspace");
  });

  it("falls back without rendering empty context segments", () => {
    expect(threadContextLabel("", "/work/codewide")).toBe("codewide");
    expect(threadContextLabel("Workstation", "")).toBe("Workstation · workspace");
  });
});

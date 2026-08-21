import { describe, expect, it } from "vitest";

import {
  joinDirectoryPath,
  parentDirectoryPath,
  partitionDiscoveredProjects,
  pathCrumbs,
  projectIncludesDirectory,
  type RemoteProject,
} from "../src/data/remote-projects";

function project(path: string, lastUsedAt: number): RemoteProject {
  return {
    path,
    name: path.split("/").at(-1) || path,
    addedAt: lastUsedAt,
    lastUsedAt,
  };
}

describe("remote projects", () => {
  it("keeps pinned projects separate and deduplicates discovered paths", () => {
    const pinned = [project("/work/codewide-wt", 10)];
    const discovered = [
      { ...project("/work/codewide", 9), aliases: ["/work/codewide", "/work/codewide-wt/"] },
      project("/work/recent", 8),
      project("/work/recent", 7),
      project("/work/other", 6),
    ];

    expect(partitionDiscoveredProjects(pinned, discovered, 1)).toEqual({
      recent: [project("/work/recent", 8)],
      other: [project("/work/other", 6)],
    });
    expect(projectIncludesDirectory(discovered[0]!, "/work/codewide-wt")).toBe(true);
  });

  it("builds navigable Unix breadcrumbs", () => {
    expect(pathCrumbs("/home/sergey/Projects")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "sergey", path: "/home/sergey" },
      { label: "Projects", path: "/home/sergey/Projects" },
    ]);
    expect(parentDirectoryPath("/home/sergey/Projects")).toBe("/home/sergey");
    expect(joinDirectoryPath("/home/sergey", "Projects")).toBe("/home/sergey/Projects");
  });

  it("builds navigable Windows breadcrumbs", () => {
    expect(pathCrumbs("C:\\Users\\sergey\\Projects")).toEqual([
      { label: "C:\\", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "sergey", path: "C:\\Users\\sergey" },
      { label: "Projects", path: "C:\\Users\\sergey\\Projects" },
    ]);
  });
});

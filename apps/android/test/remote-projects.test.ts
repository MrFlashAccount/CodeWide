import { describe, expect, it } from "vitest";

import {
  joinDirectoryPath,
  directoryCrumbs,
  parentDirectoryPath,
  parseRemoteProjects,
  parseProjectHome,
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
    pinned: true,
  };
}

describe("remote projects", () => {
  it("accepts only a server-provided absolute Home path", () => {
    expect(parseProjectHome({ path: "/srv/users/custom/" })).toBe("/srv/users/custom");
    expect(parseProjectHome({ path: "C:\\Users\\remote" })).toBe("C:\\Users\\remote");
    for (const value of [null, {}, { path: "~" }, { path: "relative/path" }, { path: "/home/\0user" }]) {
      expect(() => parseProjectHome(value)).toThrow("invalid home directory");
    }
  });

  it("uses a Home breadcrumb only for the resolved server directory", () => {
    expect(directoryCrumbs("/srv/custom/projects/app", "/srv/custom")).toEqual([
      { label: "Home", path: "/srv/custom" },
      { label: "projects", path: "/srv/custom/projects" },
      { label: "app", path: "/srv/custom/projects/app" },
    ]);
    expect(directoryCrumbs("/srv/custom-other", "/srv/custom")).toEqual(pathCrumbs("/srv/custom-other"));
    expect(directoryCrumbs("/", "/srv/custom")).toEqual([{ label: "/", path: "/" }]);
  });

  it("accepts companion-owned pinned and discovered projects", () => {
    expect(parseRemoteProjects({ data: [
      { path: "/work/pinned", name: "pinned", addedAt: 1, lastUsedAt: 2, pinned: true },
      { path: "/work/recent", name: "recent", addedAt: 3, lastUsedAt: 4, pinned: false },
    ] })).toEqual([
      { ...project("/work/pinned", 2), addedAt: 1 },
      { ...project("/work/recent", 4), addedAt: 3, pinned: false },
    ]);
  });

  it("keeps pinned projects separate and deduplicates discovered paths", () => {
    const pinned = [project("/work/codewide-wt", 10)];
    const discovered = [
      project("/work/codewide-wt/", 9),
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

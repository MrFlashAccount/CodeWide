import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import type { RemoteProject } from "../../data/remote-projects";
import { partitionDiscoveredProjects, projectIncludesDirectory } from "../../data/remote-projects";
import { listRowPosition, type AppListRowProps } from "../../ui/AppListRow.types";

export type ProjectSectionId = "other" | "recent";
export type ProjectListItem =
  | {
      compact: boolean;
      icon: keyof typeof Ionicons.glyphMap;
      id: string;
      kind: "empty";
      text: string;
    }
  | {
      id: string;
      kind: "project";
      pinned: boolean;
      position: AppListRowProps["position"];
      project: RemoteProject;
    }
  | {
      count: number;
      expanded: boolean;
      id: string;
      kind: "section";
      sectionId: ProjectSectionId | null;
      title: string;
    }
  | { id: string; kind: "server-default" };
const RECENT_PROJECT_LIMIT = 8;
/** Project sections retain query matching, pinned classification and expansion state. */
export function useProjectPickerRows(
  projects: readonly RemoteProject[],
  discoveredProjects: readonly RemoteProject[],
  normalizedQuery: string,
  expandedSections: ReadonlySet<ProjectSectionId>,
) {
  const { recent: recentProjects, other: otherProjects } = useMemo(
    () => partitionDiscoveredProjects(projects, discoveredProjects, RECENT_PROJECT_LIMIT),
    [discoveredProjects, projects],
  );
  const unpinnedProjects = [...recentProjects, ...otherProjects];
  const searchProjects =
    normalizedQuery === ""
      ? []
      : [...projects, ...unpinnedProjects].filter((project) =>
          `${project.name}\n${project.path}`.toLocaleLowerCase().includes(normalizedQuery),
        );
  const projectRows: ProjectListItem[] = [];
  if (normalizedQuery !== "") {
    projectRows.push({
      count: searchProjects.length,
      expanded: true,
      id: "section:search",
      kind: "section",
      sectionId: null,
      title: "Search results",
    });
    for (const [index, project] of searchProjects.entries()) {
      projectRows.push({
        id: `project:${project.path}`,
        kind: "project",
        pinned: projects.some((candidate) => projectIncludesDirectory(candidate, project.path)),
        position: listRowPosition(index, searchProjects.length),
        project,
      });
    }
    if (searchProjects.length === 0)
      projectRows.push({
        compact: true,
        icon: "search-outline",
        id: "empty:search",
        kind: "empty",
        text: "No matching projects",
      });
  } else {
    projectRows.push({
      count: projects.length,
      expanded: true,
      id: "section:pinned",
      kind: "section",
      sectionId: null,
      title: "Pinned",
    });
    for (const [index, project] of projects.entries()) {
      projectRows.push({
        id: `project:${project.path}`,
        kind: "project",
        pinned: true,
        position: listRowPosition(index, projects.length),
        project,
      });
    }
    if (projects.length === 0)
      projectRows.push({
        compact: true,
        icon: "pin-outline",
        id: "empty:pinned",
        kind: "empty",
        text: "Add a folder to pin it here",
      });
    if (unpinnedProjects.length > 0) {
      const recentExpanded = expandedSections.has("recent");
      projectRows.push({
        count: recentProjects.length,
        expanded: recentExpanded,
        id: "section:recent",
        kind: "section",
        sectionId: "recent",
        title: "Recent",
      });
      if (recentExpanded) {
        for (const [index, project] of recentProjects.entries()) {
          projectRows.push({
            id: `project:${project.path}`,
            kind: "project",
            pinned: false,
            position: listRowPosition(index, recentProjects.length),
            project,
          });
        }
      }
      if (otherProjects.length > 0) {
        const otherExpanded = expandedSections.has("other");
        projectRows.push({
          count: otherProjects.length,
          expanded: otherExpanded,
          id: "section:other",
          kind: "section",
          sectionId: "other",
          title: "Other",
        });
        if (otherExpanded) {
          for (const [index, project] of otherProjects.entries()) {
            projectRows.push({
              id: `project:${project.path}`,
              kind: "project",
              pinned: false,
              position: listRowPosition(index, otherProjects.length),
              project,
            });
          }
        }
      }
    }
    projectRows.push({ id: "server-default", kind: "server-default" });
  }
  return { unpinnedProjects, projectRows };
}

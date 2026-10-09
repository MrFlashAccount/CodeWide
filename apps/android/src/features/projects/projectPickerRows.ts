import type { ServerIconId } from "../../data/serverIcons";
import { normalizeDirectoryPath } from "../../data/remote-projects";
import type { Ionicons } from "@expo/vector-icons";
import { listRowPosition, type AppListRowProps } from "../../ui/AppListRow.types";
import type { ProjectPickerChoice } from "./projectPickerContract";

const RECENT_PROJECT_LIMIT = 8;

/** Expansion keys are independent of project names and server identity. */
export type ProjectSectionId = "other" | "recent";
/** A render row retains its qualified choice even when names and paths collide. */
type ProjectListItem =
  | {
      compact: boolean;
      icon: keyof typeof Ionicons.glyphMap;
      id: string;
      kind: "empty";
      text: string;
    }
  | {
      choice: ProjectPickerChoice;
      id: string;
      kind: "project";
      pinned: boolean;
      position: AppListRowProps["position"];
    }
  | {
      count: number;
      expanded: boolean;
      id: string;
      kind: "section";
      sectionId: ProjectSectionId | null;
      title: string;
    }
  | {
      available: boolean;
      connectionId: string;
      iconId: ServerIconId;
      id: string;
      kind: "server-default";
      serverName: string;
    };

/** Project sections retain query matching, pinned classification and expansion state across qualified servers. */
export function useProjectPickerRows(
  choices: readonly ProjectPickerChoice[],
  normalizedQuery: string,
  expandedSections: ReadonlySet<ProjectSectionId>,
) {
  const pinned = choices.filter((choice) => choice.project.pinned);
  const pinnedPaths = new Set(
    pinned.map(({ project, server }) =>
      JSON.stringify([server.id, normalizeDirectoryPath(project.path)]),
    ),
  );
  const seen = new Set<string>();
  const unpinnedProjects = choices
    .filter(({ project, server }) => {
      const key = JSON.stringify([server.id, normalizeDirectoryPath(project.path)]);
      if (project.pinned || pinnedPaths.has(key) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.project.lastUsedAt - left.project.lastUsedAt);
  const projectRows: ProjectListItem[] = [];
  const append = (
    title: string,
    entries: readonly ProjectPickerChoice[],
    sectionId: ProjectSectionId | null,
  ): void => {
    const expanded = sectionId === null || expandedSections.has(sectionId);
    projectRows.push({
      count: entries.length,
      expanded,
      id: `section:${title}`,
      kind: "section",
      sectionId,
      title,
    });
    if (!expanded) {
      return;
    }
    for (const [index, choice] of entries.entries()) {
      projectRows.push({
        choice,
        id: JSON.stringify([choice.server.id, choice.project.path]),
        kind: "project",
        pinned: choice.project.pinned,
        position: listRowPosition(index, entries.length),
      });
    }
  };
  if (normalizedQuery !== "") {
    const matches = [...pinned, ...unpinnedProjects].filter(({ project, server }) =>
      `${project.name}\n${project.path}\n${server.name}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
    append("Search results", matches, null);
    if (matches.length === 0) {
      projectRows.push({
        compact: true,
        icon: "search-outline",
        id: "empty:search",
        kind: "empty",
        text: "No matching projects",
      });
    }
  } else {
    if (pinned.length > 0) {
      append("Pinned", pinned, null);
    }
    if (unpinnedProjects.length > 0) {
      append("Recent", unpinnedProjects.slice(0, RECENT_PROJECT_LIMIT), "recent");
    }
    if (unpinnedProjects.length > RECENT_PROJECT_LIMIT) {
      append("Other", unpinnedProjects.slice(RECENT_PROJECT_LIMIT), "other");
    }
  }
  return { projectRows, unpinnedProjects };
}

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
      /** Why a suggested row is offered; `null` for catalog rows. */
      note: string | null;
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

/** A suggested choice and the reason its row shows. */
export type SuggestedProjectChoice = {
  readonly choice: ProjectPickerChoice;
  readonly note: string;
};

function choiceKey({ project, server }: ProjectPickerChoice): string {
  return JSON.stringify([server.id, normalizeDirectoryPath(project.path)]);
}

/**
 * Project sections retain query matching, pinned classification and expansion state across
 * qualified servers. Suggestions lead in their own section and are not repeated below it.
 */
export function useProjectPickerRows({
  choices: catalogChoices,
  expandedSections,
  normalizedQuery,
  suggested,
}: {
  readonly choices: readonly ProjectPickerChoice[];
  readonly expandedSections: ReadonlySet<ProjectSectionId>;
  readonly normalizedQuery: string;
  readonly suggested: readonly SuggestedProjectChoice[];
}) {
  const suggestedKeys = new Set(suggested.map(({ choice }) => choiceKey(choice)));
  const choices = catalogChoices.filter((choice) => !suggestedKeys.has(choiceKey(choice)));
  const pinned = choices.filter((choice) => choice.project.pinned);
  const pinnedPaths = new Set(pinned.map(choiceKey));
  const seen = new Set<string>();
  const unpinnedProjects = choices
    .filter((choice) => {
      const key = choiceKey(choice);
      if (choice.project.pinned || pinnedPaths.has(key) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.project.lastUsedAt - left.project.lastUsedAt);
  const projectRows: ProjectListItem[] = [];
  const notes = new Map(suggested.map(({ choice, note }) => [choiceKey(choice), note]));
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
        note: notes.get(choiceKey(choice)) ?? null,
        pinned: choice.project.pinned,
        position: listRowPosition(index, entries.length),
      });
    }
  };
  if (normalizedQuery !== "") {
    const matches = [
      ...suggested.map(({ choice }) => choice),
      ...pinned,
      ...unpinnedProjects,
    ].filter(({ project, server }) =>
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
    if (suggested.length > 0) {
      append(
        "Suggested",
        suggested.map(({ choice }) => choice),
        null,
      );
    }
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

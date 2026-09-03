import type { SavedServerId } from "../../domain/ids";
import type { ActionMenuItem } from "../../ui/ActionMenu";

export type NewThreadComposerAction =
  | "drawing"
  | "files"
  | "goal"
  | "ports"
  | "skills"
  | "terminal";

export interface NewThreadComposerActionContext {
  savedServerId: SavedServerId;
  workspace: string | null;
}

const NEW_THREAD_COMPOSER_ACTIONS = [
  { icon: "attach-outline", id: "files", label: "Attach file" },
  { icon: "brush-outline", id: "drawing", label: "Drawing" },
  {
    description: "Create the thread before setting its goal",
    disabled: true,
    icon: "flag-outline",
    id: "goal",
    label: "Goal",
  },
  {
    description: "Create the thread before opening its terminal",
    disabled: true,
    icon: "terminal-outline",
    id: "terminal",
    label: "Terminal",
  },
  { icon: "git-network-outline", id: "ports", label: "Port forward" },
  { icon: "sparkles-outline", id: "skills", label: "Skills" },
] as const;

export function newThreadComposerActions(workspace: string | null): ActionMenuItem[] {
  return NEW_THREAD_COMPOSER_ACTIONS.map((action) =>
    action.id === "skills" && workspace === null
      ? {
          ...action,
          description: "Select a project before choosing a skill",
          disabled: true,
        }
      : action,
  );
}

export function isNewThreadComposerAction(value: string): value is NewThreadComposerAction {
  return NEW_THREAD_COMPOSER_ACTIONS.some((action) => action.id === value);
}

export function composerActionLabel(action: NewThreadComposerAction): string {
  return NEW_THREAD_COMPOSER_ACTIONS.find((candidate) => candidate.id === action)?.label ?? action;
}

export function actionFailure(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

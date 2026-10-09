import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";

import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import type { SidebarProject, SidebarProjectActions } from "./sidebarProjects";

/** Owns the pending command and errors for one qualified shortcut lifetime. */
export function useProjectShortcutActions(
  project: SidebarProject,
  actions: SidebarProjectActions | undefined,
): { readonly pending: boolean; readonly select: (id: string) => void } {
  const pending$ = useConstant(() => observable(false));
  const pending = useSelector(pending$);
  const dialog = useAppDialog();
  const select = useEvent((id: string): void => {
    if (actions === undefined || pending$.peek()) {
      return;
    }
    const action = id === "unpin" ? actions.unpin : id === "read" ? actions.markAllRead : null;
    if (action === null) {
      return;
    }
    const label = id === "unpin" ? "Unpin project" : "Mark all as read";
    pending$.set(true);
    void action(project)
      .catch((error: unknown) => {
        dialog.error(`${label} failed`, error);
      })
      .finally(() => {
        pending$.set(false);
      });
  });
  return { pending, select };
}

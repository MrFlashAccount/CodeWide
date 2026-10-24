import { createContext, useContext } from "react";

/** Layout capability exposed only to destinations that can add a third pane. */
export type WorkspacePaneController = {
  readonly setDetailExpanded: (expanded: boolean) => void;
};

export const WorkspacePaneControllerContext = createContext<WorkspacePaneController | null>(null);

/** Lets a destination claim the catalog width while a third pane is visible. */
export function useWorkspacePaneController(): WorkspacePaneController {
  const controller = useContext(WorkspacePaneControllerContext);
  if (controller === null) {
    throw new Error("useWorkspacePaneController must be used inside WorkspacePaneLayout");
  }
  return controller;
}

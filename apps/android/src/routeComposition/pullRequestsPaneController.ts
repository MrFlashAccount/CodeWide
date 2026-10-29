import { createContext, useContext } from "react";

/** Narrow command surface shared by the Pull requests subtree and its active detail route. */
export type PullRequestsPaneController = {
  readonly setDetailExpanded: (owner: symbol, expanded: boolean) => void;
};

const PullRequestsPaneControllerContext = createContext<PullRequestsPaneController | null>(null);

/** Supplies the subtree-owned pane command to mounted Pull request detail routes. */
export const PullRequestsPaneControllerProvider = PullRequestsPaneControllerContext.Provider;

/** Lets the mounted PR destination claim the catalog width while its third pane is visible. */
export function usePullRequestsPaneController(): PullRequestsPaneController {
  const controller = useContext(PullRequestsPaneControllerContext);
  if (controller === null) {
    throw new Error(
      "usePullRequestsPaneController must be used inside PullRequestsWorkspaceRouteLayout",
    );
  }
  return controller;
}

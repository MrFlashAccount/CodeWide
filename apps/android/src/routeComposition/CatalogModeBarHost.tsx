import { useSelector } from "@legendapp/state/react";

import { remoteValue } from "../data/forgeRemoteValue";
import { forgeResources } from "../data/forgeRuntime";
import { CatalogModeBar, type CatalogMode } from "../features/pullRequests/CatalogModeBar";
import { reviewRequestedCount } from "../features/pullRequests/pullRequestListModel";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { pullRequestCatalogConnection } from "./pullRequestCatalogConnection";
import { usePullRequestNavigation } from "./pullRequestNavigation";

const REVIEW_REQUESTED = { category: "reviewRequested", repository: null } as const;

/**
 * Always-mounted catalog bottom bar. Its count is the review-requested PR
 * count of the catalog's companion, read from the same list resource the PR
 * tab shows; an older companion simply shows no count.
 */
export function CatalogModeBarHost({ mode }: { readonly mode: CatalogMode }): React.JSX.Element {
  const { list } = useWorkspaceRouteResources();
  const navigation = usePullRequestNavigation();
  const connectionId = pullRequestCatalogConnection(list.serverScope, list.servers);
  const params = connectionId === null ? null : { ...REVIEW_REQUESTED, connectionId };
  if (params !== null) {
    forgeResources.lists.ensure(params);
  }
  const page = useSelector(() =>
    params === null
      ? undefined
      : forgeResources.lists.state$[forgeResources.lists.keyOf(params)]?.get(),
  );
  return (
    <CatalogModeBar
      mode={mode}
      onSelect={navigation.switchCatalog}
      reviewRequestedCount={reviewRequestedCount(remoteValue(page))}
    />
  );
}

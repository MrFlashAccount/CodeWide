import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../src/components/navigation/RouteUnavailable";
import { GlobalSearchScreen } from "../../src/features/search/GlobalSearchScreen";
import { workspaceFeatures as features } from "../../src/features/workspace/createWorkspaceFeatures";
import {
  routeSessionIdParam,
  workspaceRouteSessionOwner,
} from "../../src/services/threads/threadRouteParams";
import { searchRouteSessions } from "../../src/services/search/searchRouteSession";
import { useRouteSessionLifetime } from "../../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../../src/services/workspace/workspaceRouteResources";

const SEARCH_REMOTE = {
  searchMessages: features.search.searchMessages.bind(features.search),
};

/** Composes one bounded search session without serializing its query or filters. */
export default function V1SearchRoute(): React.JSX.Element {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const id = routeSessionIdParam(sessionId);
  const resources = useWorkspaceRouteResources();
  const entry =
    id.status === "valid"
      ? searchRouteSessions.get(id.value.value, workspaceRouteSessionOwner)
      : null;
  useRouteSessionLifetime(
    entry?.id ?? null,
    (entryId) => {
      searchRouteSessions.close(entryId);
    },
    (entryId) => searchRouteSessions.retain(entryId, workspaceRouteSessionOwner),
  );
  if (entry === null) {
    return (
      <RouteUnavailable
        message="Open search again to start a new session."
        onBack={() => {
          router.dismissTo("/v1");
        }}
        title="Search expired"
      />
    );
  }
  const close = (): void => {
    searchRouteSessions.close(entry.id);
    router.dismissTo("/v1");
  };
  return (
    <GlobalSearchScreen
      onClose={close}
      onOpenThread={resources.list.openSearchThread}
      projects={resources.project.projectWorkspace.searchProjects}
      remote={SEARCH_REMOTE}
      servers={resources.list.servers}
      session={entry.session}
      threads={resources.list.scopedThreads}
    />
  );
}

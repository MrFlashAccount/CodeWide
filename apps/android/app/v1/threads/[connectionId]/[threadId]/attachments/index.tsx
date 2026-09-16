import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../../src/components/navigation/RouteUnavailable";
import { threadResourceKey } from "../../../../../../src/data/workspace-resource-keys";
import { ThreadAttachmentsRoute } from "../../../../../../src/features/attachments/ThreadAttachmentsRoute";
import { workspaceFeatures as features } from "../../../../../../src/features/workspace/createWorkspaceFeatures";
import { documentRouteService } from "../../../../../../src/services/documents/documentRouteService";
import {
  threadRouteSessionOwner,
  v1ThreadRouteParams,
} from "../../../../../../src/services/threads/threadRouteParams";
import { useWorkspaceRouteResources } from "../../../../../../src/services/workspace/workspaceRouteResources";

/** Composes attachments for one validated thread and opens documents by opaque session id. */
export default function V1AttachmentsRoute(): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    threadId?: string | string[];
  }>();
  const params = v1ThreadRouteParams(raw);
  const resources = useWorkspaceRouteResources();
  if (params.status === "invalid") {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        onBack={router.back}
        title="Attachments unavailable"
      />
    );
  }
  const connectionId = params.value.connectionId.value;
  const threadId = params.value.threadId.value;
  const resourceId = threadResourceKey(connectionId, threadId);
  const cwd =
    resources.list.loadedThreadSummaries.find(
      (thread) => thread.connectionId === connectionId && thread.remoteThreadId === threadId,
    )?.cwd ?? "/workspace";
  const getTransferAccess = async (forceRefresh = false) =>
    features.attachments.transferAccess(connectionId, forceRefresh);
  return (
    <ThreadAttachmentsRoute
      cwd={cwd}
      getTransferAccess={getTransferAccess}
      model={resources.runtime.resources?.threadResources ?? null}
      onClose={router.back}
      onOpenDocument={(request) => {
        const session = documentRouteService.open(threadRouteSessionOwner(params.value), request);
        router.push({
          params: { connectionId, sessionId: session.id, threadId },
          pathname: "/v1/threads/[connectionId]/[threadId]/documents/[sessionId]",
        });
      }}
      onReload={async () =>
        features.changes.loadThreadResources(connectionId, threadId, undefined, "attachments")
      }
      resourceId={resourceId}
      revision={
        resources.connections.find((connection) => connection.id === connectionId)?.state ??
        "offline"
      }
    />
  );
}

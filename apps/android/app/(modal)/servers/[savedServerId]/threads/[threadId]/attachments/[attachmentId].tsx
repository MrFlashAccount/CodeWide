import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import { useEvent } from "@/react/useEvent";
import { useV2Runtime } from "@/v2/application/react/V2RuntimeContext";
import type { ProjectionResource } from "@/v2/application/resources/projectionResource";
import { AttachmentPreviewWorkspace } from "@/v2/features/attachments/AttachmentPreviewWorkspace";
import { V2QueryBoundary } from "@/v2/features/shared/V2QueryBoundary";
import { opaqueRouteParam, qualifiedThreadRouteParams } from "@/v2/features/navigation/routeParams";
import { workspaceFilePreviewDestination } from "@/v2/features/navigation/routeDestinations";
import type { QualifiedThread } from "@/v2/domain/qualifiedThread";
import { quickdrawImageSource } from "@/v2/platform/drawing/quickdrawImageSource";
import { ExpoVideoPlayer } from "@/v2/platform/rendering/ExpoVideoPlayer";
import { NativeWebPreview } from "@/v2/platform/rendering/NativeWebPreview";
import { openExternalMarkdownLink } from "@/v2/platform/rendering/openExternalMarkdownLink";
import { ResourceStateView } from "@/v2/presentation/feedback/ResourceStateView";
import { WorkspaceSafeAreaView } from "@/v2/presentation/layouts/AdaptiveWorkspaceView";

const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function AttachmentPreviewRoute(): React.JSX.Element {
  const params =
    useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId]">();
  const owner = qualifiedThreadRouteParams(params);
  const attachmentId = opaqueRouteParam(params.attachmentId);
  if (owner === null || attachmentId === null) return <Redirect href="/servers" />;
  return <QualifiedAttachmentPreviewRoute attachmentId={attachmentId} owner={owner} />;
}

interface QualifiedAttachmentPreviewRouteProps {
  attachmentId: string;
  owner: QualifiedThread;
}

type ThreadResourcesResult = Extract<V2QueryResult, { kind: "thread.resources" }>;

function QualifiedAttachmentPreviewRoute(
  props: QualifiedAttachmentPreviewRouteProps,
): React.JSX.Element {
  const runtime = useV2Runtime();
  const [outer, setOuter] = useState(() =>
    runtime.projection(props.owner.savedServerId, props.owner.threadId),
  );
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const retry = useEvent(() => {
    runtime.reconnect(props.owner.savedServerId);
    setOuter(runtime.projection(props.owner.savedServerId, props.owner.threadId));
  });
  if (opened.value === null) {
    return (
      <AttachmentRouteState
        message={opened.status === "error" ? opened.message : "Opening attachment…"}
        onRetry={retry}
        status={opened.status === "error" ? "error" : "loading"}
      />
    );
  }
  return <ProjectedAttachmentPreviewRoute {...props} onRetry={retry} resource={opened.value} />;
}

interface ProjectedAttachmentPreviewRouteProps extends QualifiedAttachmentPreviewRouteProps {
  onRetry(): void;
  resource: ProjectionResource;
}

function ProjectedAttachmentPreviewRoute(
  props: ProjectedAttachmentPreviewRouteProps,
): React.JSX.Element {
  const { attachmentId, onRetry, owner, resource } = props;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const openWorkspaceFile = useEvent((path: string) => {
    router.push(workspaceFilePreviewDestination(owner, path));
  });
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const thread = projection?.currentThread?.thread;
  if (thread?.id !== owner.threadId) {
    return (
      <AttachmentRouteState
        message={
          snapshot.status === "error"
            ? (snapshot.message ?? "Could not open attachment")
            : "Opening attachment…"
        }
        onRetry={onRetry}
        status={snapshot.status === "error" ? "error" : "loading"}
      />
    );
  }
  // This render prop is intentionally a render-time callback. useEvent rejects
  // callbacks invoked while React renders; the compiler owns its memoization.
  const renderAttachment = (result: ThreadResourcesResult): React.ReactNode => {
    return (
      <AttachmentPreviewWorkspace
        key={attachmentId}
        attachments={result.attachments}
        imageSource={quickdrawImageSource}
        initialAttachmentId={attachmentId}
        navigate={router.push}
        openExternalLink={openExternalMarkdownLink}
        openWorkspaceFile={openWorkspaceFile}
        owner={owner}
        Player={ExpoVideoPlayer}
        WebPreview={NativeWebPreview}
        workspace={thread.workspace}
      />
    );
  };
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <WorkspaceSafeAreaView>
        <V2QueryBoundary
          chrome="none"
          query={{
            cursor: null,
            kind: "thread.resources",
            limit: 100,
            scope: "session",
            threadId: owner.threadId,
          }}
          savedServerId={owner.savedServerId}
          title="Attachment"
        >
          {renderAttachment}
        </V2QueryBoundary>
      </WorkspaceSafeAreaView>
    </>
  );
}

interface AttachmentRouteStateProps {
  message: string;
  onRetry(): void;
  status: "error" | "loading";
}

function AttachmentRouteState(props: AttachmentRouteStateProps): React.JSX.Element {
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <WorkspaceSafeAreaView>
        <ResourceStateView {...props} />
      </WorkspaceSafeAreaView>
    </>
  );
}

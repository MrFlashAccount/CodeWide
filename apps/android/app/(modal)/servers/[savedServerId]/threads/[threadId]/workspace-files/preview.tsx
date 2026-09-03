import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import { useEvent } from "@/react/useEvent";
import { useV2Runtime } from "@/v2/application/react/V2RuntimeContext";
import type { ProjectionResource } from "@/v2/application/resources/projectionResource";
import type { QualifiedThread } from "@/v2/domain/qualifiedThread";
import { AttachmentPreviewWorkspace } from "@/v2/features/attachments/AttachmentPreviewWorkspace";
import { workspaceFilePreviewDestination } from "@/v2/features/navigation/routeDestinations";
import {
  qualifiedThreadRouteParams,
  workspacePathRouteParam,
} from "@/v2/features/navigation/routeParams";
import { V2QueryBoundary } from "@/v2/features/shared/V2QueryBoundary";
import { quickdrawImageSource } from "@/v2/platform/drawing/quickdrawImageSource";
import { ExpoVideoPlayer } from "@/v2/platform/rendering/ExpoVideoPlayer";
import { NativeWebPreview } from "@/v2/platform/rendering/NativeWebPreview";
import { openExternalMarkdownLink } from "@/v2/platform/rendering/openExternalMarkdownLink";
import { ResourceStateView } from "@/v2/presentation/feedback/ResourceStateView";
import { WorkspaceSafeAreaView } from "@/v2/presentation/layouts/AdaptiveWorkspaceView";

const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function WorkspaceFilePreviewRoute(): React.JSX.Element {
  const params = useLocalSearchParams();
  const owner = qualifiedThreadRouteParams(params);
  const path = workspacePathRouteParam(params.path);
  if (owner === null || path === null) return <Redirect href="/servers" />;
  return <QualifiedWorkspaceFileRoute owner={owner} path={path} />;
}

interface QualifiedWorkspaceFileRouteProps {
  owner: QualifiedThread;
  path: string;
}

type WorkspaceFileResult = Extract<V2QueryResult, { kind: "workspace.file" }>;

function QualifiedWorkspaceFileRoute(props: QualifiedWorkspaceFileRouteProps): React.JSX.Element {
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
    return <WorkspaceFileRouteState onRetry={retry} status={opened.status} />;
  }
  return <ProjectedWorkspaceFileRoute {...props} resource={opened.value} />;
}

interface ProjectedWorkspaceFileRouteProps extends QualifiedWorkspaceFileRouteProps {
  resource: ProjectionResource;
}

function ProjectedWorkspaceFileRoute(props: ProjectedWorkspaceFileRouteProps): React.JSX.Element {
  const { owner, path, resource } = props;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const thread = projection?.currentThread?.thread;
  const openWorkspaceFile = useEvent((nextPath: string) => {
    router.push(workspaceFilePreviewDestination(owner, nextPath));
  });
  const retry = useEvent(() => {
    resource.refresh().catch(() => undefined);
  });
  if (thread?.id !== owner.threadId) {
    return <WorkspaceFileRouteState onRetry={retry} status={snapshot.status} />;
  }
  // Render-time callback: useEvent intentionally cannot wrap it.
  const renderFile = (result: WorkspaceFileResult): React.ReactNode => {
    return (
      <AttachmentPreviewWorkspace
        attachments={[result.file]}
        imageSource={quickdrawImageSource}
        initialAttachmentId={result.file.id}
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
          query={{ kind: "workspace.file", path, threadId: owner.threadId }}
          savedServerId={owner.savedServerId}
          title="Workspace file"
        >
          {renderFile}
        </V2QueryBoundary>
      </WorkspaceSafeAreaView>
    </>
  );
}

interface WorkspaceFileRouteStateProps {
  onRetry(): void;
  status: "error" | "loading" | "ready";
}

function WorkspaceFileRouteState(props: WorkspaceFileRouteStateProps): React.JSX.Element {
  const { onRetry, status } = props;
  return (
    <WorkspaceSafeAreaView>
      <ResourceStateView
        message={status === "error" ? "Could not open workspace file" : "Opening workspace file…"}
        onRetry={onRetry}
        status={status === "error" ? "error" : "loading"}
      />
    </WorkspaceSafeAreaView>
  );
}

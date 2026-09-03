import type { V2U64 } from "@codewide/sync-client/v2";
import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { useTerminalPlatform } from "../../application/react/TerminalPlatformContext";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import { MAX_TERMINAL_TABS } from "../../domain/terminalSession";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { TerminalWorkspaceView } from "../../presentation/terminal/TerminalWorkspaceView";

interface TerminalScreenProps {
  owner: QualifiedThread;
}

interface TerminalProjection {
  cwd: string | null;
  generation: V2U64 | null;
}

interface ProjectedTerminalProps extends TerminalScreenProps {
  resource: ProjectionResource;
}

interface TerminalContentProps extends TerminalScreenProps {
  projection: TerminalProjection | null;
}

export function TerminalScreen(props: TerminalScreenProps): React.JSX.Element {
  return (
    <TerminalScreenResource
      key={`${props.owner.savedServerId}\u0000${props.owner.threadId}`}
      owner={props.owner}
    />
  );
}

function TerminalScreenResource(props: TerminalScreenProps): React.JSX.Element {
  const { owner } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.projection(owner.savedServerId, owner.threadId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const retryOpening = useEvent((): Promise<void> => outer.refresh());
  if (opened.status !== "ready" || opened.value === null) {
    return (
      <ResourceStateView
        message={opened.status === "error" ? opened.message : "Loading terminal…"}
        onRetry={retryOpening}
        status={opened.status === "error" ? "error" : "loading"}
      />
    );
  }
  return <ProjectedTerminal owner={owner} resource={opened.value} />;
}

function ProjectedTerminal(props: ProjectedTerminalProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const snapshot = useSyncExternalStore(
    props.resource.subscribe,
    props.resource.snapshot,
    props.resource.snapshot,
  );
  const requestedThread = props.resource.requestedThreadAuthority();
  const projection = snapshot.value.projections.live;
  const currentThread = projection?.currentThread?.thread;
  const retryProjection = useEvent((): Promise<void> => props.resource.refresh());
  const retryThreadAuthority = useEvent(async (): Promise<void> => {
    await runtime.sessions.open(props.owner.savedServerId, props.owner.threadId);
  });
  if (requestedThread.threadId === props.owner.threadId && requestedThread.status === "error") {
    return (
      <ResourceStateView
        message={requestedThread.message}
        onRetry={retryThreadAuthority}
        status="error"
      />
    );
  }
  if (snapshot.status === "error") {
    return (
      <ResourceStateView message={snapshot.message} onRetry={retryProjection} status="error" />
    );
  }
  // A retained projection is available before watchThread establishes live authority. Binding a
  // terminal to it would use the wrong workspace/generation while the real route is still opening.
  if (
    requestedThread.threadId !== props.owner.threadId ||
    requestedThread.status !== "ready" ||
    snapshot.value.state !== "live" ||
    projection === null ||
    currentThread?.id !== props.owner.threadId
  ) {
    return <ResourceStateView message="Loading terminal…" status="loading" />;
  }
  return (
    <TerminalContent
      owner={props.owner}
      projection={{
        cwd: currentThread.workspace,
        generation: projection.sourceGeneration,
      }}
    />
  );
}

function TerminalContent(props: TerminalContentProps): React.JSX.Element {
  const { owner, projection } = props;
  const runtime = useV2Runtime();
  const platform = useTerminalPlatform();
  const workspace = useSyncExternalStore(
    runtime.terminal.subscribe,
    () => runtime.terminal.workspaceSnapshot(owner),
    () => runtime.terminal.workspaceSnapshot(owner),
  );
  const [backgroundProcesses] = useState(() => runtime.backgroundProcesses(owner));
  const processSnapshot = useSyncExternalStore(
    backgroundProcesses.subscribe,
    backgroundProcesses.snapshot,
    backgroundProcesses.snapshot,
  );
  const [backgroundsVisible, setBackgroundsVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const active =
    workspace.sessions.find((candidate) => candidate.id === workspace.activeId) ??
    workspace.sessions[0] ??
    null;
  const reportError = useEvent((value: string): void => setActionError(value));
  const Renderer = platform.Renderer;
  const RouteBinding = platform.RouteBinding;
  const create = useEvent(async (): Promise<void> => {
    if (projection?.generation === null || projection?.generation === undefined)
      throw new Error("Terminal generation is unavailable");
    setActionError(null);
    await runtime.terminal.open(owner, projection.generation, projection.cwd);
  });
  const close = useEvent(async (id: string): Promise<void> => {
    setActionError(null);
    await runtime.terminal.close(owner, id);
  });
  const select = useEvent((id: string): void => runtime.terminal.select(owner, id));
  const toggleBackgrounds = useEvent((): void => {
    if (!backgroundsVisible) backgroundProcesses.refresh().catch(() => undefined);
    setBackgroundsVisible(!backgroundsVisible);
  });
  const refreshBackgrounds = useEvent((): Promise<void> => backgroundProcesses.refresh());
  const terminateBackground = useEvent(async (processId: string): Promise<void> => {
    setActionError(null);
    try {
      await backgroundProcesses.terminate(processId);
    } catch (cause) {
      setActionError(terminalErrorMessage(cause, "Could not terminate background process"));
    }
  });
  const retryReplay = useEvent(async (id: string): Promise<void> => {
    setActionError(null);
    await runtime.terminal.retryReplay(id);
  });
  const minimize = useEvent((): void => router.back());
  return (
    <>
      <RouteBinding
        controller={runtime.terminal}
        cwd={projection?.cwd ?? null}
        enabled={workspace.sessions.length === 0}
        generation={projection?.generation ?? null}
        onError={reportError}
        owner={owner}
      />
      <TerminalWorkspaceView
        activeTerminal={
          active === null ? null : (
            <Renderer key={active.id} controller={runtime.terminal} session={active} />
          )
        }
        activeSession={active}
        backgroundError={processSnapshot.status === "error" ? processSnapshot.message : null}
        backgroundProcesses={processSnapshot.value}
        backgroundStatus={processSnapshot.status}
        backgroundsVisible={backgroundsVisible}
        canCreate={
          projection !== null &&
          projection.generation !== null &&
          workspace.sessions.length < MAX_TERMINAL_TABS
        }
        error={actionError}
        onClose={close}
        onCreate={create}
        onMinimize={minimize}
        onRefreshBackgrounds={refreshBackgrounds}
        onRetryReplay={retryReplay}
        onSelect={select}
        onTerminateBackground={terminateBackground}
        onToggleBackgrounds={toggleBackgrounds}
        tabs={workspace.sessions.map((session) => ({
          active: session.id === active?.id,
          exitCode: session.exitCode,
          id: session.id,
          signal: session.signal,
          status: session.status,
          title: session.title,
        }))}
      />
    </>
  );
}

function terminalErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

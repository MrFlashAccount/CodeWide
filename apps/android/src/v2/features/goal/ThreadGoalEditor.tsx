import type { V2QueryResult, V2ThreadGoal, V2ThreadGoalUpdate } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { updateThreadGoal, validateThreadGoal } from "../../application/goal/threadGoal";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QueryResourceHandle } from "../../application/resources/queryResource";
import type { ResourceSnapshot } from "../../application/resources/resource";
import type { SavedServerId, ThreadId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { ThreadGoalSheetView } from "../../presentation/goal/ThreadGoalSheetView";
import { useVoiceInputControl } from "../conversation/VoiceInputControl";

interface ThreadGoalEditorProps {
  goalResource: QueryResourceHandle;
  onClose(): void;
  projectionResource: ProjectionResource;
  savedServerId: SavedServerId;
  threadId: ThreadId;
}

/** Binds the authoritative goal projection to one local editor draft and Voice scope. */
export function ThreadGoalEditor(props: ThreadGoalEditorProps): React.JSX.Element {
  const { goalResource, projectionResource, threadId } = props;
  const goalSnapshot = useSyncExternalStore(
    goalResource.subscribe,
    goalResource.snapshot,
    goalResource.snapshot,
  );
  const projectionSnapshot = useSyncExternalStore(
    projectionResource.subscribe,
    projectionResource.snapshot,
    projectionResource.snapshot,
  );
  const read = threadGoalFromSnapshot(goalSnapshot, threadId);
  const { goal } = read;
  const draftKey =
    goal === null
      ? `${threadId}:none`
      : `${threadId}:${goal.objective}\u0000${goal.status}\u0000${goal.tokenBudget ?? ""}`;
  return (
    <ThreadGoalDraft
      key={draftKey}
      error={goalSnapshot.status === "error" ? goalSnapshot.message : read.error}
      goal={goal}
      goalResource={goalResource}
      loading={goalSnapshot.status === "loading"}
      onClose={props.onClose}
      projectionResource={projectionResource}
      projectionSnapshot={projectionSnapshot}
      savedServerId={props.savedServerId}
      threadId={threadId}
    />
  );
}

interface ThreadGoalDraftProps extends ThreadGoalEditorProps {
  error: string | null;
  goal: V2ThreadGoal | null;
  loading: boolean;
  projectionSnapshot: ReturnType<ProjectionResource["snapshot"]>;
}

function ThreadGoalDraft(props: ThreadGoalDraftProps): React.JSX.Element {
  const {
    error,
    goal,
    goalResource,
    loading,
    onClose,
    projectionSnapshot,
    savedServerId,
    threadId,
  } = props;
  const runtime = useV2Runtime();
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState(
    goal?.tokenBudget === null || goal?.tokenBudget === undefined ? "" : String(goal.tokenBudget),
  );
  const appendTranscript = useEvent((text: string) => {
    setObjective((current) => (current.trim() === "" ? text : `${current.trimEnd()} ${text}`));
  });
  const scope = { id: `goal:${threadId}`, kind: "generic" } as const;
  const voice = useVoiceInputControl({
    audience: savedServerId,
    live:
      projectionSnapshot.value.state === "live" &&
      projectionSnapshot.value.projections.live !== null,
    onTranscript: appendTranscript,
    projection: projectionSnapshot.value.projections.live,
    scope,
    thread: qualifiedThread(savedServerId, threadId),
  });
  const save = useEvent(async (): Promise<void> => {
    requireCurrentGoal(goalResource);
    const expectedGoal = validateThreadGoal(objective, tokenBudget, goal?.status ?? "active");
    await updateThreadGoal({
      commands: runtime.commandActivations,
      goal: expectedGoal,
      savedServerId,
      threadId,
    });
    await refreshAndVerifyGoal(goalResource, threadId, expectedGoal);
  });
  const clear = useEvent(async (): Promise<void> => {
    requireCurrentGoal(goalResource);
    await updateThreadGoal({
      commands: runtime.commandActivations,
      goal: null,
      savedServerId,
      threadId,
    });
    await refreshAndVerifyGoal(goalResource, threadId, null);
  });
  return (
    <ThreadGoalSheetView
      error={error}
      goal={goal}
      loading={loading}
      objective={objective}
      onClear={clear}
      onClose={onClose}
      onObjectiveChange={setObjective}
      onSave={save}
      onTokenBudgetChange={setTokenBudget}
      tokenBudget={tokenBudget}
      voice={voice}
    />
  );
}

interface ThreadGoalRead {
  error: string | null;
  goal: V2ThreadGoal | null;
}

function threadGoalFromSnapshot(
  snapshot: ResourceSnapshot<V2QueryResult | null>,
  expectedThreadId: ThreadId,
): ThreadGoalRead {
  const value = snapshot.value;
  if (value === null) return { error: null, goal: null };
  if (
    value.kind !== "thread.goal" ||
    value.threadId !== expectedThreadId ||
    (value.goal !== null && value.goal.threadId !== expectedThreadId)
  ) {
    return { error: "Server returned an invalid goal result", goal: null };
  }
  return { error: null, goal: value.goal };
}

async function refreshAndVerifyGoal(
  resource: QueryResourceHandle,
  expectedThreadId: ThreadId,
  expectedGoal: V2ThreadGoalUpdate | null,
): Promise<void> {
  await resource.refresh();
  const snapshot = resource.snapshot();
  if (snapshot.status === "error") throw new Error(snapshot.message);
  const value = snapshot.value;
  if (
    value === null ||
    value.kind !== "thread.goal" ||
    value.threadId !== expectedThreadId ||
    (value.goal !== null && value.goal.threadId !== expectedThreadId)
  ) {
    throw new Error("Server returned an invalid goal result");
  }
  if (!goalMatchesUpdate(value.goal, expectedGoal)) {
    throw new Error("Server did not confirm the goal update");
  }
}

function requireCurrentGoal(resource: QueryResourceHandle): void {
  if (!resource.actionable()) throw new Error("Wait for the current goal before changing it");
}

function goalMatchesUpdate(goal: V2ThreadGoal | null, update: V2ThreadGoalUpdate | null): boolean {
  if (goal === null || update === null) return goal === null && update === null;
  return (
    goal.objective === update.objective &&
    goal.status === update.status &&
    goal.tokenBudget === update.tokenBudget
  );
}

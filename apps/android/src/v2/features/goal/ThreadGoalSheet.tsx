import { useState, useSyncExternalStore } from "react";

import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QueryResourceHandle } from "../../application/resources/queryResource";
import type { SavedServerId, ThreadId } from "../../domain/ids";
import { ThreadGoalSheetView } from "../../presentation/goal/ThreadGoalSheetView";
import { ThreadGoalEditor } from "./ThreadGoalEditor";

interface ThreadGoalSheetProps {
  onClose(): void;
  savedServerId: SavedServerId;
  threadId: ThreadId;
}

/** Owns the live `thread.goal` projection and keeps draft state inside its presentation child. */
export function ThreadGoalSheet(props: ThreadGoalSheetProps): React.JSX.Element {
  const { onClose, savedServerId, threadId } = props;
  const runtime = useV2Runtime();
  const [goalOuter] = useState(() =>
    runtime.query(savedServerId, { kind: "thread.goal", threadId }),
  );
  const [projectionOuter] = useState(() => runtime.projection(savedServerId, threadId));
  const openedGoal = useSyncExternalStore(
    goalOuter.subscribe,
    goalOuter.snapshot,
    goalOuter.snapshot,
  );
  const openedProjection = useSyncExternalStore(
    projectionOuter.subscribe,
    projectionOuter.snapshot,
    projectionOuter.snapshot,
  );
  if (openedGoal.value === null || openedProjection.value === null) {
    return (
      <ThreadGoalSheetView
        error={openingError(openedGoal, openedProjection)}
        goal={null}
        loading={openedGoal.status === "loading" || openedProjection.status === "loading"}
        objective=""
        onClear={unavailableGoalAction}
        onClose={onClose}
        onObjectiveChange={ignoreObjectiveChange}
        onSave={unavailableGoalAction}
        onTokenBudgetChange={ignoreObjectiveChange}
        tokenBudget=""
      />
    );
  }
  return (
    <ThreadGoalEditor
      goalResource={openedGoal.value}
      onClose={onClose}
      projectionResource={openedProjection.value}
      savedServerId={savedServerId}
      threadId={threadId}
    />
  );
}

interface OpeningSnapshot {
  message?: string;
  status: "error" | "loading" | "ready";
  value: ProjectionResource | QueryResourceHandle | null;
}

function openingError(goal: OpeningSnapshot, projection: OpeningSnapshot): string | null {
  if (goal.status === "error") return goal.message ?? "Could not load goal";
  if (projection.status === "error") return projection.message ?? "Could not open saved server";
  return null;
}

function ignoreObjectiveChange(): void {}

function unavailableGoalAction(): Promise<never> {
  return Promise.reject(new Error("Goal is unavailable while the server is connecting"));
}

import { useSelector } from "@legendapp/state/react";
import { useState } from "react";

import { remoteValue, type RemoteValue } from "../../../data/forgeRemoteValue";
import { diffSourceKey, type DiffSource } from "../../../data/reviewContract";
import type { GuideState, GuideStop } from "../../../data/reviewGuideContract";
import type { ReviewResources } from "../../../data/reviewResources";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { GuideAuthor, ReviewTargetCapabilities } from "../reviewTargetCapabilities";
import { resumeIndex, walkStops, type WalkStop } from "./guideWalk";
import { guideWalkModel } from "./guideWalkModel";

/** Guide state plus the walk position and its intents. */
export type GuideWalk = {
  readonly accept: (stop: GuideStop) => void;
  readonly accepting: boolean;
  readonly current: WalkStop | null;
  /** The companion's reason when the guide could not be read and nothing is published. */
  readonly failure: string | null;
  readonly request: () => void;
  readonly select: (index: number) => void;
  readonly state: GuideState | null;
  readonly stops: readonly WalkStop[];
};

/**
 * Reads one source's guide (a progressive resource) and owns the walk: the
 * selected stop (resuming at the first open one), Accept, which advances, and
 * Request guide from the chosen author at the current revision.
 */
export function useGuideWalk({
  author,
  capabilities,
  connectionId,
  resources,
  source,
}: {
  readonly author: GuideAuthor | null;
  readonly capabilities: ReviewTargetCapabilities;
  readonly connectionId: string;
  readonly resources: Pick<ReviewResources, "guide">;
  readonly source: DiffSource;
}): GuideWalk {
  const dialog = useAppDialog();
  const params = { connectionId, source };
  resources.guide.ensure(params);
  const walkKey = `${connectionId}\u0000${diffSourceKey(source)}`;
  const snapshot = useSelector(() => resources.guide.state$[resources.guide.keyOf(params)]?.get());
  const state = remoteValue(snapshot);
  const selected = useSelector(() => guideWalkModel[walkKey]?.get());
  const [accepting, setAccepting] = useState(false);
  const stops = guideStops(state);
  const index = walkIndex(state, stops, selected);
  const select = useEvent((next: number): void => {
    guideWalkModel[walkKey]?.set(next);
  });
  const request = useEvent((): void => {
    if (author === null || state === null) {
      return;
    }
    capabilities
      .requestGuide(connectionId, { author, revision: state.currentRevision, source })
      .catch((error: unknown) => {
        dialog.error("Could not request a guide", error);
      });
  });
  const accept = useEvent((stop: GuideStop): void => {
    const guide = state === null ? null : state.guide;
    if (guide === null || state === null) {
      return;
    }
    setAccepting(true);
    capabilities
      .setStopState(connectionId, {
        guideId: guide.guideId,
        revision: state.currentRevision,
        source,
        state: "accepted",
        stopId: stop.stopId,
      })
      .then(() => {
        if (index + 1 < stops.length) {
          select(index + 1);
        }
      })
      .catch((error: unknown) => {
        dialog.error("Could not accept the stop", error);
      })
      .finally(() => {
        setAccepting(false);
      });
  });
  return {
    accept,
    accepting,
    current: stops[index] ?? null,
    failure: failureReason(snapshot),
    request,
    select,
    state,
    stops,
  };
}

function guideStops(state: GuideState | null): readonly WalkStop[] {
  return state === null || state.guide === null ? [] : walkStops(state.guide);
}

/** The selected stop, else the first open one, clamped to the walk. */
function walkIndex(
  state: GuideState | null,
  stops: readonly WalkStop[],
  selected: number | undefined,
): number {
  const resume = state === null ? 0 : resumeIndex(state, stops);
  return Math.min(selected ?? resume, Math.max(0, stops.length - 1));
}

function failureReason(snapshot: RemoteValue<GuideState> | undefined): string | null {
  return snapshot?.status === "failed" ? snapshot.failure.message : null;
}

import type { Observable } from "@legendapp/state";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type {
  ActivityPage,
  PullRequestOverview,
  PullRequestRow,
} from "../../data/forgePullRequestContract";
import { useLoadedListRow } from "../../data/forgeListPages";
import type { OverviewParams } from "../../data/forgeOverview";
import { forgeQueryRemoteValue, useForgeQuery } from "../../data/forgeQueryResource";
import { remoteValue } from "../../data/forgeRemoteValue";
import { notePullRequestAttentionDisplayed } from "../../data/pullRequestAttention";
import type { ThreadId } from "../../data/reviewContract";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { spacing } from "../../theme";
import { measureActionLabel, OVERFLOW_BUTTON_WIDTH } from "./actions/actionMeasure";
import { slotActions, type ActionSlots } from "./actions/actionSlotting";
import { dockCounts } from "./changes/dockCounts";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import {
  createPullRequestScreenModel,
  type PullRequestScreenState,
} from "./pullRequestScreenModel";

/** Everything the PR screen renders from its resources and its own model. */
export type PullRequestScreenData = {
  readonly activity: ActivityPage;
  readonly agentThread: { readonly threadId: ThreadId; readonly title: string } | null;
  readonly draftCount: number;
  /** The PR's row from a loaded list, for the review request and age; `null` on a cold deep link. */
  readonly listRow: PullRequestRow | null;
  readonly loadMoreActivity: (() => void) | null;
  readonly model: Observable<PullRequestScreenState>;
  readonly offline: boolean;
  readonly overview: PullRequestOverview;
  readonly params: OverviewParams;
  readonly setRowWidth: (width: number) => void;
  readonly slots: ActionSlots;
};

/**
 * Reads the PR screen's data: the Suspense-owned overview and its live refresh
 * state; the slotted catalog for the measured action row; the draft count; and
 * the thread a review's agent half goes to. Owns one screen model per mounted
 * route session.
 */
export function usePullRequestScreen(props: PullRequestScreenProps): PullRequestScreenData {
  const params: OverviewParams = {
    connectionId: props.connectionId,
    pullRequest: props.pullRequest,
  };
  const model = useConstant(createPullRequestScreenModel);
  const [rowWidth, setRowWidth] = useState(0);
  const { offline, overview } = useOverview(props, params);
  const attentionRevision =
    overview.attention.state === "unsupported" ? null : overview.attention.revision;
  useEffect(() => {
    if (attentionRevision === null) {
      return;
    }
    notePullRequestAttentionDisplayed(props.pullRequest, attentionRevision);
    props.capabilities
      .markAttentionSeen({
        connectionId: props.connectionId,
        pullRequest: props.pullRequest,
        revision: attentionRevision,
      })
      .catch(() => undefined);
  }, [attentionRevision, props.capabilities, props.connectionId, props.pullRequest]);
  const { activity, loadMoreActivity } = useActivity(props, params, overview);
  const agentLink = overview.reviewThread;
  return {
    activity,
    agentThread:
      agentLink === null
        ? null
        : {
            threadId: agentLink.threadId,
            title: props.describeThread(agentLink.threadId)?.title ?? "Linked thread",
          },
    draftCount: useDraftCount(props),
    listRow: useLoadedListRow(props.forge.lists, props.connectionId, props.pullRequest),
    loadMoreActivity,
    model,
    offline,
    overview,
    params,
    setRowWidth,
    slots: pullRequestSlots(overview, rowWidth, props.tablet),
  };
}

function useOverview(
  props: PullRequestScreenProps,
  params: OverviewParams,
): { readonly offline: boolean; readonly overview: PullRequestOverview } {
  const query = useSuspenseQuery(
    props.forge.overviews.options(params),
    props.forge.overviews.client,
  );
  const live = forgeQueryRemoteValue(query);
  return {
    offline: live.status === "failed" && live.failure.kind === "unreachable",
    overview: remoteValue(live) ?? query.data,
  };
}

function useDraftCount(props: PullRequestScreenProps): number {
  const params = {
    connectionId: props.connectionId,
    source: { kind: "pullRequest" as const, pullRequest: props.pullRequest },
  };
  const drafts = useForgeQuery(props.review.drafts, params);
  return dockCounts(remoteValue(drafts)?.drafts ?? []).total;
}

function useActivity(
  props: PullRequestScreenProps,
  params: OverviewParams,
  overview: PullRequestOverview,
): { readonly activity: ActivityPage; readonly loadMoreActivity: (() => void) | null } {
  const state = useForgeQuery(props.forge.activity, params);
  const activity = remoteValue(state) ?? overview.activity;
  const loadMore = useEvent((): void => {
    if (props.forge.activity.data(params) === null) {
      props.forge.activity.publish(params, overview.activity);
    }
    // A failed page keeps the items already shown; the button stays to try again.
    props.forge.loadMoreActivity(params).catch(() => undefined);
  });
  if (activity.nextCursor === null) {
    return { activity, loadMoreActivity: null };
  }
  return { activity, loadMoreActivity: loadMore };
}

/** Slots the catalog for the measured action row and the anchors visible on this screen. */
function pullRequestSlots(
  overview: PullRequestOverview,
  rowWidth: number,
  tablet: boolean,
): ActionSlots {
  return slotActions(
    overview.catalog.actions,
    {
      checkIds: new Set(overview.checkItems.map((item) => item.checkId)),
      conflict: overview.merge.state === "conflicts",
      reviewThreadIds: new Set(
        overview.activity.items.flatMap((item) =>
          item.reviewThreadId === null ? [] : [item.reviewThreadId],
        ),
      ),
    },
    {
      availableWidth: Math.max(0, rowWidth - OVERFLOW_BUTTON_WIDTH - spacing.xs),
      gap: spacing.xs,
      measure: measureActionLabel,
      tablet,
    },
  );
}

/** Thread title fallback used where a label is required. */
export function threadTitle(
  describe: PullRequestScreenProps["describeThread"],
  threadId: ThreadId,
): string {
  return describe(threadId)?.title ?? "Linked thread";
}

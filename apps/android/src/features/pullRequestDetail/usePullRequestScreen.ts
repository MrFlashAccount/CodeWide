import type { Observable } from "@legendapp/state";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ForgeProvider } from "../../data/forgeContract";
import type { ProviderIcon } from "../../data/forgeProviderIcon";
import type {
  ActivityPage,
  PullRequestOverview,
  PullRequestRow,
} from "../../data/forgePullRequestContract";
import { useLoadedListRow } from "../../data/forgeListPages";
import type { OverviewParams } from "../../data/forgeOverview";
import { useMinuteClock } from "../../data/minuteClock";
import { forgeQueryRemoteValue, useForgeQuery } from "../../data/forgeQueryResource";
import { remoteValue } from "../../data/forgeRemoteValue";
import { notePullRequestAttentionDisplayed } from "../../data/pullRequestAttention";
import type { ThreadId } from "../../data/reviewContract";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { spacing } from "../../theme";
import { measureActionLabel } from "./actions/actionMeasure";
import { slotActions, type ActionSlots } from "./actions/actionSlotting";
import {
  scenarioFailure,
  scenarioViews,
  withScenarioLabels,
  type ScenarioViews,
} from "./actions/scenarioRuns";
import { dockCounts } from "./changes/dockCounts";
import {
  useConversationWrites,
  type ConversationWrites,
} from "./conversation/useConversationWrites";
import {
  usePullRequestConversation,
  type PullRequestConversation,
} from "./conversation/usePullRequestConversation";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import {
  createPullRequestScreenModel,
  type PullRequestScreenState,
} from "./pullRequestScreenModel";

/** Everything the PR screen renders from its resources and its own model. */
export type PullRequestScreenData = {
  readonly activity: ActivityPage;
  readonly agentThread: {
    readonly threadId: ThreadId;
    readonly title: string;
  } | null;
  /** The conversation that replaces the activity list, or `unsupported`. */
  readonly conversation: PullRequestConversation;
  readonly draftCount: number;
  /** The PR's row from a loaded list, for the review request and age; `null` on a cold deep link. */
  readonly listRow: PullRequestRow | null;
  readonly loadMoreActivity: (() => void) | null;
  readonly model: Observable<PullRequestScreenState>;
  readonly offline: boolean;
  readonly overview: PullRequestOverview;
  readonly params: OverviewParams;
  /** Capabilities the PR account's plugin declares; empty until the accounts snapshot loads. */
  readonly providerCapabilities: readonly string[];
  /** The PR account's provider mark from the accounts snapshot; `null` until it loads. */
  readonly providerIcon: ProviderIcon | null;
  /** The first scenario whose run failed at the shown head, with the real reason. */
  readonly scenarioFailure: {
    readonly label: string;
    readonly reason: string;
  } | null;
  /** The Companion's live run state of each scenario action at the shown head. */
  readonly scenarioViews: ScenarioViews;
  readonly setRowWidth: (width: number) => void;
  readonly slots: ActionSlots;
  readonly writes: ConversationWrites;
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
  const model = useConstant(() => createPullRequestScreenModel(props.initialChangesView));
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
  const provider = useProvider(props, overview.account.pluginId);
  const conversation = usePullRequestConversation({
    forge: props.forge,
    params,
    provider,
  });
  const writes = useConversationWrites({
    capabilities: props.capabilities,
    offline,
    params,
  });
  const agentLink = overview.reviewThread;
  const scenarios = scenarioViews(
    overview.catalog.actions,
    remoteValue(useForgeQuery(props.forge.scenarios, params)),
    overview.headRevision,
  );
  const labelled = withScenarioLabels(overview.catalog.actions, scenarios, useMinuteClock());
  return {
    activity,
    agentThread:
      agentLink === null
        ? null
        : {
            threadId: agentLink.threadId,
            title: props.describeThread(agentLink.threadId)?.title ?? "Linked thread",
          },
    conversation,
    draftCount: useDraftCount(props),
    listRow: useLoadedListRow(props.forge.lists, props.connectionId, props.pullRequest),
    loadMoreActivity,
    model,
    offline,
    overview,
    params,
    providerCapabilities: capabilitiesOf(provider),
    providerIcon: provider?.icon ?? null,
    scenarioFailure: scenarioFailure(overview.catalog.actions, scenarios),
    scenarioViews: scenarios,
    setRowWidth,
    slots: pullRequestSlots(labelled, overview, {
      reviewThreadIds: visibleReviewThreadIds(overview, conversation),
      rowWidth,
      tablet: props.tablet,
    }),
    writes,
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

/** The provider of the PR's account; a cold deep link has no catalog behind it, so it reads the accounts resource. */
function useProvider(props: PullRequestScreenProps, pluginId: string): ForgeProvider | null {
  const accounts = useForgeQuery(props.forge.accounts, {
    connectionId: props.connectionId,
  });
  return (
    remoteValue(accounts)?.providers.find((candidate) => candidate.pluginId === pluginId) ?? null
  );
}

/** What the PR account's plugin declares; nothing until the accounts snapshot names it. */
function capabilitiesOf(provider: ForgeProvider | null): readonly string[] {
  return provider === null ? [] : provider.capabilities;
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
): {
  readonly activity: ActivityPage;
  readonly loadMoreActivity: (() => void) | null;
} {
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

/** Review threads the Details tab shows: the conversation's when it replaces the activity list. */
function visibleReviewThreadIds(
  overview: PullRequestOverview,
  conversation: PullRequestConversation,
): ReadonlySet<string> {
  if (conversation.status === "ready") {
    return new Set(
      conversation.page.entries.flatMap((entry) =>
        entry.kind === "reviewThread" ? [entry.thread.id] : [],
      ),
    );
  }
  return new Set(
    overview.activity.items.flatMap((item) =>
      item.reviewThreadId === null ? [] : [item.reviewThreadId],
    ),
  );
}

/**
 * Slots the (live-labelled) catalog for the measured action row and the anchors visible on
 * this screen.
 */
function pullRequestSlots(
  actions: PullRequestOverview["catalog"]["actions"],
  overview: PullRequestOverview,
  layout: {
    readonly reviewThreadIds: ReadonlySet<string>;
    readonly rowWidth: number;
    readonly tablet: boolean;
  },
): ActionSlots {
  return slotActions(
    actions,
    {
      checkIds: new Set(overview.checkItems.map((item) => item.checkId)),
      conflict: overview.merge.state === "conflicts",
      reviewThreadIds: layout.reviewThreadIds,
    },
    {
      availableWidth: layout.rowWidth,
      gap: spacing.xs,
      measure: measureActionLabel,
      tablet: layout.tablet,
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

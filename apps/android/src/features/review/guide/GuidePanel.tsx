import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import type { DiffSource, ThreadId } from "../../../data/reviewContract";
import type { GuideState, GuideStop, ReviewGuide } from "../../../data/reviewGuideContract";
import type { ReviewResources } from "../../../data/reviewResources";
import { colors, spacing, typeScale } from "../../../theme";
import { ageAgo } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import type { GuideAuthor, ReviewTargetCapabilities } from "../reviewTargetCapabilities";
import { GuideNarration } from "./GuideNarration";
import { GuideRequestCard } from "./GuideRequestCard";
import { GuideStrip } from "./GuideStrip";
import { changedStopCount, stopProgress, type WalkStop } from "./guideWalk";
import { StopActions } from "./StopActions";
import { useGuideWalk, type GuideWalk } from "./useGuideWalk";

/** Props of the source-independent guide panel. */
export type GuidePanelProps = {
  /** `null` when no author can be chosen (for example offline). */
  readonly author: GuideAuthor | null;
  readonly authorLabel: string;
  readonly capabilities: ReviewTargetCapabilities;
  readonly connectionId: string;
  readonly describeThread: (threadId: ThreadId) => string;
  readonly nowMs: number;
  /** Opens the comment sheet on the stop; `agent` preselects the Agent destination. */
  readonly onComment: (stop: GuideStop, destination: "agent" | "default") => void;
  readonly renderStopDiff: (stop: GuideStop) => ReactNode;
  readonly resources: Pick<ReviewResources, "guide">;
  readonly source: DiffSource;
};

/**
 * Guided walk over any diff source: request a guide from the chosen author,
 * then step through chapters and stops with Comment, Send to agent and Accept.
 * The same panel serves PR, session and VCS reviews; the caller renders the
 * stop's diff and opens its comment sheet.
 */
export function GuidePanel(props: GuidePanelProps): React.JSX.Element {
  const walk = useGuideWalk(props);
  const { state } = walk;
  if (state === null) {
    return (
      <View style={styles.fill}>
        {walk.failure === null ? null : <Text style={styles.meta}>{walk.failure}</Text>}
      </View>
    );
  }
  const showRequest = state.guide === null || state.pending !== null || state.lastError !== null;
  return (
    <View style={styles.fill} testID="review-guide-panel">
      {showRequest ? (
        <GuideRequestCard
          authorLabel={props.authorLabel}
          disabled={props.author === null}
          onRequest={walk.request}
          state={state}
        />
      ) : null}
      {state.guide === null || walk.current === null ? null : (
        <GuideWalkView
          current={walk.current}
          guide={state.guide}
          props={props}
          state={state}
          walk={walk}
        />
      )}
    </View>
  );
}

function GuideWalkView({
  current,
  guide,
  props,
  state,
  walk,
}: {
  readonly current: WalkStop;
  readonly guide: ReviewGuide;
  readonly props: GuidePanelProps;
  readonly state: GuideState;
  readonly walk: GuideWalk;
}): React.JSX.Element {
  const progress = stopProgress(state, current.stop);
  return (
    <>
      <GuideStrip current={current} onSelect={walk.select} state={state} stops={walk.stops} />
      <GuideAge guide={guide} nowMs={props.nowMs} state={state} />
      <GuideNarration
        authorTitle={props.describeThread(guide.authorThreadId)}
        changed={progress === "changed"}
        stop={current.stop}
      />
      <View style={styles.fill}>{props.renderStopDiff(current.stop)}</View>
      {guide.support.length === 0 ? null : (
        <Text style={styles.meta}>{supportLabel(guide.support.length)}</Text>
      )}
      <StopActions
        onAccept={() => {
          walk.accept(current.stop);
        }}
        onComment={() => {
          props.onComment(current.stop, "default");
        }}
        onSendToAgent={() => {
          props.onComment(current.stop, "agent");
        }}
        pending={walk.accepting}
        progress={progress}
      />
    </>
  );
}

/** "Support · 1 hunk outside the walk" with the noun agreeing with the count. */
function supportLabel(count: number): string {
  return `Support · ${String(count)} ${count === 1 ? "hunk" : "hunks"} outside the walk`;
}

/** "Guide from 2h ago · 3 changed" once the source moved past the guide's revision. */
function GuideAge({
  guide,
  nowMs,
  state,
}: {
  readonly guide: ReviewGuide;
  readonly nowMs: number;
  readonly state: GuideState;
}): React.JSX.Element | null {
  if (guide.revision === state.currentRevision) {
    return null;
  }
  const changed = changedStopCount(state);
  return (
    <Text
      style={styles.meta}
    >{`Guide from ${ageAgo(guide.createdAt, nowMs)}${changed === 0 ? "" : ` · ${String(changed)} changed`}`}</Text>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    gap: spacing.xs,
    minHeight: 0,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
  },
});

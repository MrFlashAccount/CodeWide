import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestOverview, PullRequestRow } from "../../../data/forgePullRequestContract";
import type { ThreadId } from "../../../data/reviewContract";
import {
  colors,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { AppText as Text } from "../../../ui/Typography";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import type { ActionSlots } from "../actions/actionSlotting";
import { AutoMergeRow } from "./AutoMergeRow";
import { checksSummaryLine } from "./checkPresentation";
import type { LinkedThreadDescription } from "../linkedThreadDescription";
import { MergeMethodButton } from "./MergeMethodButton";
import { mergeOptions } from "./mergeOptions";

const MERGE_STATE = {
  blocked: { label: "Blocked", tone: "danger" },
  conflicts: { label: "Conflicts", tone: "danger" },
  ready: { label: "Ready", tone: "success" },
  unknown: { label: "Checking", tone: "neutral" },
} as const;

const READINESS_ROW_MIN_HEIGHT = 68;

type ReadinessPanelProps = {
  readonly describeThread: (threadId: ThreadId) => LinkedThreadDescription | null;
  readonly host: string;
  readonly listRow: PullRequestRow | null;
  readonly onOpenReviewChat: () => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly slots: Pick<ActionSlots, "anchored" | "autoMerge" | "merge">;
};

/** One flat readiness surface from the accepted Details design. */
export function ReadinessPanel({
  describeThread,
  host,
  listRow,
  onOpenReviewChat,
  onRun,
  overview,
  pending,
  pendingToggles,
  slots,
}: ReadinessPanelProps): React.JSX.Element {
  return (
    <View style={styles.panel} testID="pull-request-readiness">
      <Text accessibilityRole="header" style={styles.title}>
        Readiness
      </Text>
      <MergeReadiness
        host={host}
        onRun={onRun}
        overview={overview}
        pending={pending}
        pendingToggles={pendingToggles}
        slots={slots}
      />
      <ChecksReadiness onRun={onRun} overview={overview} pending={pending} slots={slots} />
      <ReviewReadiness listRow={listRow} />
      <BranchReadiness overview={overview} />
      <ReviewThreadReadiness
        describeThread={describeThread}
        onOpen={onOpenReviewChat}
        overview={overview}
      />
    </View>
  );
}

function MergeReadiness({
  host,
  onRun,
  overview,
  pending,
  pendingToggles,
  slots,
}: Pick<
  ReadinessPanelProps,
  "host" | "onRun" | "overview" | "pending" | "pendingToggles" | "slots"
>): React.JSX.Element {
  const [method, setMethod] = useState<string | null>(null);
  const [mergeAction] = slots.merge;
  const options = mergeOptions(mergeAction);
  const selected = options.find((option) => option.value === method) ?? options[0] ?? null;
  const merge = MERGE_STATE[overview.merge.state];
  return (
    <ReadinessRow
      detail={overview.merge.reason ?? "Merge requirements are satisfied."}
      label="Merge"
      trailing={<CaptionBadge label={merge.label} tone={merge.tone} />}
    >
      <MergeMethodControl
        action={mergeAction}
        onRun={onRun}
        onSelectMethod={setMethod}
        options={options}
        overview={overview}
        pending={pending}
        selected={selected}
      />
      <AutoMergeControl
        action={slots.autoMerge}
        host={host}
        methodLabel={selected?.label ?? "Merge"}
        onRun={onRun}
        pending={pending}
        pendingToggles={pendingToggles}
      />
    </ReadinessRow>
  );
}

function MergeMethodControl({
  action,
  onRun,
  onSelectMethod,
  options,
  overview,
  pending,
  selected,
}: {
  readonly action: ActionDescriptor | undefined;
  readonly onRun: ReadinessPanelProps["onRun"];
  readonly onSelectMethod: (method: string | null) => void;
  readonly options: ReturnType<typeof mergeOptions>;
  readonly overview: PullRequestOverview;
  readonly pending: ReadinessPanelProps["pending"];
  readonly selected: ReturnType<typeof mergeOptions>[number] | null;
}): React.JSX.Element | null {
  if (action === undefined) {
    return null;
  }
  return (
    <MergeMethodButton
      action={action}
      muted={overview.merge.state === "blocked" || overview.merge.state === "conflicts"}
      onRun={onRun}
      onSelectMethod={onSelectMethod}
      options={options}
      pending={pending[action.actionId] === true}
      selected={selected}
    />
  );
}

function AutoMergeControl({
  action,
  host,
  methodLabel,
  onRun,
  pending,
  pendingToggles,
}: {
  readonly action: ActionDescriptor | null;
  readonly host: string;
  readonly methodLabel: string;
  readonly onRun: ReadinessPanelProps["onRun"];
  readonly pending: ReadinessPanelProps["pending"];
  readonly pendingToggles: ReadinessPanelProps["pendingToggles"];
}): React.JSX.Element | null {
  if (action === null) {
    return null;
  }
  return (
    <AutoMergeRow
      action={action}
      host={host}
      methodLabel={methodLabel}
      onRun={onRun}
      pending={pending[action.actionId] === true}
      requested={pendingToggles[action.actionId] ?? null}
    />
  );
}

function ChecksReadiness({
  onRun,
  overview,
  pending,
  slots,
}: Pick<ReadinessPanelProps, "onRun" | "overview" | "pending" | "slots">): React.JSX.Element {
  const detail =
    overview.checks.state === "unavailable"
      ? overview.checks.reason
      : checksSummaryLine(overview.checks);
  const trailing =
    overview.checks.state === "passing" ? (
      <Ionicons color={colors.success} name="checkmark" size={iconSize.inline} />
    ) : null;
  return (
    <ReadinessRow detail={detail} label="Checks" trailing={trailing}>
      {overview.checkItems.map((check) => (
        <CheckLine
          actions={slots.anchored.checks.get(check.checkId) ?? []}
          key={check.checkId}
          name={check.name}
          onRun={onRun}
          pending={pending}
        />
      ))}
    </ReadinessRow>
  );
}

function CheckLine({
  actions,
  name,
  onRun,
  pending,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly name: string;
  readonly onRun: ReadinessPanelProps["onRun"];
  readonly pending: ReadinessPanelProps["pending"];
}): React.JSX.Element {
  return (
    <View style={styles.compactLine}>
      <Text numberOfLines={1} style={styles.detail}>
        {name}
      </Text>
      {actions.map((action) => (
        <CatalogActionButton
          action={action}
          key={action.actionId}
          onPress={(selected) => {
            onRun(selected, null);
          }}
          pending={pending[action.actionId] === true}
          variant="compact"
        />
      ))}
    </View>
  );
}

function ReviewReadiness({ listRow }: Pick<ReadinessPanelProps, "listRow">): React.JSX.Element {
  const requested = listRow?.reviewRequestedFromMe === true;
  const trailing = requested ? <Text style={styles.value}>Requested from you</Text> : null;
  return (
    <ReadinessRow
      detail={
        requested
          ? "You're requested to review this pull request."
          : "No review is requested from you."
      }
      label="Review"
      trailing={trailing}
    />
  );
}

function BranchReadiness({ overview }: Pick<ReadinessPanelProps, "overview">): React.JSX.Element {
  const trailing =
    overview.merge.state === "ready" ? <CaptionBadge label="Up to date" tone="success" /> : null;
  return (
    <ReadinessRow
      detail={`${overview.headBranch} → ${overview.baseBranch}`}
      label="Branch"
      trailing={trailing}
    />
  );
}

function ReviewThreadReadiness({
  describeThread,
  onOpen,
  overview,
}: {
  readonly describeThread: ReadinessPanelProps["describeThread"];
  readonly onOpen: () => void;
  readonly overview: PullRequestOverview;
}): React.JSX.Element {
  const reviewThread = overview.reviewThread;
  const description = reviewThread === null ? null : describeThread(reviewThread.threadId);
  return (
    <Pressable
      accessibilityLabel="Open linked review chat"
      accessibilityRole="button"
      onPress={onOpen}
      style={styles.row}
    >
      <ReviewThreadCopy
        detail={description?.title ?? "Start from the chat button to work with an agent."}
        linked={reviewThread !== null}
      />
      <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
    </Pressable>
  );
}

function ReviewThreadCopy({
  detail,
  linked,
}: {
  readonly detail: string;
  readonly linked: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.rowBody}>
      <ReadinessHeadline
        label="Review thread"
        trailing={<Text style={styles.value}>{linked ? "Linked" : "Not started"}</Text>}
      />
      <Text numberOfLines={1} style={styles.detail}>
        {detail}
      </Text>
    </View>
  );
}

function ReadinessRow({
  children,
  detail,
  label,
  trailing,
}: {
  readonly children?: ReactNode;
  readonly detail: string;
  readonly label: string;
  readonly trailing: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <ReadinessRowBody detail={detail} label={label} trailing={trailing}>
        {children}
      </ReadinessRowBody>
    </View>
  );
}

function ReadinessRowBody({
  children,
  detail,
  label,
  trailing,
}: {
  readonly children?: ReactNode;
  readonly detail: string;
  readonly label: string;
  readonly trailing: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.rowBody}>
      <ReadinessHeadline label={label} trailing={trailing} />
      <Text style={styles.detail}>{detail}</Text>
      {children}
    </View>
  );
}

function ReadinessHeadline({
  label,
  trailing,
}: {
  readonly label: string;
  readonly trailing: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.headline}>
      <Text style={styles.label}>{label}</Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  compactLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.compact,
  },
  detail: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
  headline: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
  },
  label: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  panel: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
  },
  row: {
    alignItems: "center",
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: READINESS_ROW_MIN_HEIGHT,
    paddingVertical: spacing.sm,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    paddingVertical: spacing.md,
  },
  value: {
    ...typeScale.label,
    color: colors.textMuted,
  },
});

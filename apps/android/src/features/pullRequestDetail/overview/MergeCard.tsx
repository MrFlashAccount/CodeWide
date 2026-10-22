import { useState } from "react";
import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { AppText as Text } from "../../../ui/Typography";
import { AutoMergeRow } from "./AutoMergeRow";
import { mergeCardStyles } from "./MergeCard.styles";
import { MergeMethodButton } from "./MergeMethodButton";
import { mergeOptions, type MergeOption } from "./mergeOptions";
import { overviewStyles as styles } from "./overview.styles";

const MERGE_STATE = {
  blocked: { label: "Blocked", tone: "danger" },
  conflicts: { label: "Conflicts", tone: "danger" },
  ready: { label: "Ready", tone: "success" },
  unknown: { label: "Checking", tone: "neutral" },
} as const;

/** Everything the merge card shows and runs. */
export type MergeCardProps = {
  readonly autoMerge: ActionDescriptor | null;
  readonly host: string;
  readonly merge: readonly ActionDescriptor[];
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  /** Forge refusal of a merge-card action, shown under its control. */
  readonly refusal: { readonly actionId: string; readonly reason: string } | null;
};

/**
 * Native merge card: the merge state with its reason, a split button for the
 * merge method (plugin default first) and the auto-merge switch. Merge and
 * auto-merge never appear as generic buttons.
 */
export function MergeCard(props: MergeCardProps): React.JSX.Element | null {
  const [mergeAction] = props.merge;
  const [method, setMethod] = useState<string | null>(null);
  if (mergeAction === undefined && props.autoMerge === null) {
    return null;
  }
  const options = mergeOptions(mergeAction);
  const selected = options.find((option) => option.value === method) ?? options[0] ?? null;
  return (
    <View style={styles.card} testID="pull-request-merge-card">
      <MergeHeader state={props.overview.merge.state} />
      <MergeControls
        mergeAction={mergeAction}
        onSelectMethod={setMethod}
        options={options}
        props={props}
        selected={selected}
      />
      <RefusalLine host={props.host} refusal={props.refusal} />
    </View>
  );
}

/** The method split button, the blocking reason and the auto-merge switch, each when present. */
function MergeControls({
  mergeAction,
  onSelectMethod,
  options,
  props,
  selected,
}: {
  readonly mergeAction: ActionDescriptor | undefined;
  readonly onSelectMethod: (value: string) => void;
  readonly options: readonly MergeOption[];
  readonly props: MergeCardProps;
  readonly selected: MergeOption | null;
}): React.JSX.Element {
  const { autoMerge } = props;
  return (
    <>
      {mergeAction === undefined ? null : (
        <MergeMethodButton
          action={mergeAction}
          muted={
            props.overview.merge.state === "blocked" || props.overview.merge.state === "conflicts"
          }
          onRun={props.onRun}
          onSelectMethod={onSelectMethod}
          options={options}
          pending={props.pending[mergeAction.actionId] === true}
          selected={selected}
        />
      )}
      <MergeReason action={mergeAction} reason={props.overview.merge.reason} />
      {autoMerge === null ? null : (
        <AutoMergeRow
          action={autoMerge}
          host={props.host}
          methodLabel={selected?.label ?? "Merge"}
          onRun={props.onRun}
          pending={props.pending[autoMerge.actionId] === true}
          requested={props.pendingToggles[autoMerge.actionId] ?? null}
        />
      )}
    </>
  );
}

function MergeHeader({
  state,
}: {
  readonly state: PullRequestOverview["merge"]["state"];
}): React.JSX.Element {
  const badge = MERGE_STATE[state];
  return (
    <View style={styles.cardHeader}>
      <Text accessibilityRole="header" style={[styles.cardTitle, styles.fill]}>
        Merge
      </Text>
      <CaptionBadge label={badge.label} tone={badge.tone} />
    </View>
  );
}

/** The merge state's reason, else the merge action's disabled reason. */
function MergeReason({
  action,
  reason,
}: {
  readonly action: ActionDescriptor | undefined;
  readonly reason: string | null;
}): React.JSX.Element | null {
  const text =
    reason ?? (action?.availability.state === "disabled" ? action.availability.reason : null);
  return text === null ? null : <Text style={[styles.meta, mergeCardStyles.reason]}>{text}</Text>;
}

function RefusalLine({
  host,
  refusal,
}: {
  readonly host: string;
  readonly refusal: MergeCardProps["refusal"];
}): React.JSX.Element | null {
  return refusal === null ? null : (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.meta, styles.danger, mergeCardStyles.reason]}
    >
      {`✕ ${host} refused: ${refusal.reason}`}
    </Text>
  );
}

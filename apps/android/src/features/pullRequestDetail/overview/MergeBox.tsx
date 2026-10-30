import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import { spacing } from "../../../theme";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import type { ActionSlots } from "../actions/actionSlotting";
import { StatusRow } from "../sections/StatusRow";
import { STATUS_TEXT_INSET } from "../sections/statusLayout";
import { AutoMergeRow } from "./AutoMergeRow";
import { mergeBox } from "./mergeBox";
import { MergeMethodButton } from "./MergeMethodButton";
import { mergeOptions, type MergeOption } from "./mergeOptions";

type MergeBoxProps = {
  /** Draws the inset hairline that separates the merge state from the Status row above. */
  readonly divided: boolean;
  readonly host: string;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly slots: Pick<ActionSlots, "anchored" | "autoMerge" | "merge">;
};

/**
 * The last rows of the Status section for an open or draft PR: the merge
 * state (with the actions anchored to a conflict below its reason), then the
 * merge method button and auto-merge. Checks have their own Status row. Owns
 * the chosen merge method. A merged or closed PR renders nothing.
 */
export function MergeBox(props: MergeBoxProps): React.JSX.Element | null {
  const box = mergeBox(props.overview);
  if (box.kind === "settled") {
    return null;
  }
  const conflict =
    props.overview.merge.state === "conflicts" && props.slots.anchored.conflict.length > 0 ? (
      <ConflictActions {...props} />
    ) : undefined;
  return (
    <View testID="pull-request-merge-box">
      <StatusRow
        detail={box.merge.detail}
        detailTone="muted"
        disclosure={{ kind: "fixed" }}
        divided={props.divided}
        testID="pull-request-merge-box-state"
        title={box.merge.title}
        tone={box.merge.tone}
      >
        {conflict}
      </StatusRow>
      <MergeControls {...props} mergeable={box.mergeable} />
    </View>
  );
}

/** The catalog actions anchored to a merge conflict, below its reason. */
function ConflictActions(props: MergeBoxProps): React.JSX.Element {
  return (
    <View style={styles.actions}>
      {props.slots.anchored.conflict.map((action) => (
        <CatalogActionButton
          action={action}
          key={action.actionId}
          onPress={(selected) => {
            props.onRun(selected, null);
          }}
          pending={props.pending[action.actionId] === true}
          variant="compact"
        />
      ))}
    </View>
  );
}

/** Split merge button (prominent only when the forge reports the PR ready) and auto-merge. */
function MergeControls(
  props: MergeBoxProps & { readonly mergeable: boolean },
): React.JSX.Element | null {
  const [method, setMethod] = useState<string | null>(null);
  const [mergeAction] = props.slots.merge;
  if (mergeAction === undefined && props.slots.autoMerge === null) {
    return null;
  }
  const options = mergeOptions(mergeAction);
  const selected = options.find((option) => option.value === method) ?? options[0] ?? null;
  return (
    <View style={styles.controls}>
      <MergeButton
        action={mergeAction}
        mergeable={props.mergeable}
        onRun={props.onRun}
        onSelectMethod={setMethod}
        options={options}
        pending={props.pending}
        selected={selected}
      />
      <AutoMerge {...props} methodLabel={selected?.label ?? "Merge"} />
    </View>
  );
}

function MergeButton({
  action,
  mergeable,
  onRun,
  onSelectMethod,
  options,
  pending,
  selected,
}: {
  readonly action: ActionDescriptor | undefined;
  readonly mergeable: boolean;
  readonly onRun: MergeBoxProps["onRun"];
  readonly onSelectMethod: (value: string) => void;
  readonly options: readonly MergeOption[];
  readonly pending: MergeBoxProps["pending"];
  readonly selected: MergeOption | null;
}): React.JSX.Element | null {
  if (action === undefined) {
    return null;
  }
  return (
    <MergeMethodButton
      action={action}
      muted={!mergeable}
      onRun={onRun}
      onSelectMethod={onSelectMethod}
      options={options}
      pending={pending[action.actionId] === true}
      selected={selected}
    />
  );
}

function AutoMerge({
  host,
  methodLabel,
  onRun,
  pending,
  pendingToggles,
  slots,
}: MergeBoxProps & { readonly methodLabel: string }): React.JSX.Element | null {
  const action = slots.autoMerge;
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

const styles = StyleSheet.create({
  actions: {
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  // Aligned with the Status rows' text, under the merge state it acts on.
  controls: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingLeft: STATUS_TEXT_INSET,
    paddingRight: spacing.md,
  },
});

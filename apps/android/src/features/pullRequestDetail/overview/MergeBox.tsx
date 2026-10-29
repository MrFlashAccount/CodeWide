import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import { colors, radii, spacing } from "../../../theme";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import type { ActionSlots } from "../actions/actionSlotting";
import { AutoMergeRow } from "./AutoMergeRow";
import { ChecksSheet } from "./ChecksSheet";
import { mergeBox, type MergeBox as MergeBoxModel } from "./mergeBox";
import { MergeBoxRow } from "./MergeBoxRow";
import { MergeMethodButton } from "./MergeMethodButton";
import { mergeOptions, type MergeOption } from "./mergeOptions";

type MergeBoxProps = {
  readonly host: string;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly slots: Pick<ActionSlots, "anchored" | "autoMerge" | "merge">;
};

type OpenBox = Extract<MergeBoxModel, { readonly kind: "open" }>;

/**
 * The PR's merge box: checks (their details in a sheet), the merge state with
 * the actions anchored to a conflict, then the merge method and auto-merge.
 * Owns the chosen merge method and the checks sheet's visibility. A merged or
 * closed PR renders nothing.
 */
export function MergeBox(props: MergeBoxProps): React.JSX.Element | null {
  const box = mergeBox(props.overview);
  if (box.kind === "settled") {
    return null;
  }
  return (
    <View style={styles.box} testID="pull-request-merge-box">
      <ChecksRow {...props} box={box} />
      <MergeStateRow {...props} box={box} />
      <MergeControls {...props} mergeable={box.mergeable} />
    </View>
  );
}

function ChecksRow({ box, ...props }: MergeBoxProps & { readonly box: OpenBox }) {
  const [open, setOpen] = useState(false);
  if (box.checks === null) {
    return null;
  }
  const listed = props.overview.checkItems.length > 0;
  return (
    <>
      <MergeBoxRow
        first
        onPress={
          listed
            ? () => {
                setOpen(true);
              }
            : null
        }
        row={box.checks}
        testID="pull-request-merge-box-checks"
      />
      {open ? (
        <ChecksSheet
          actionsFor={(checkId) => props.slots.anchored.checks.get(checkId) ?? []}
          checks={props.overview.checkItems}
          host={props.host}
          onDismiss={() => {
            setOpen(false);
          }}
          onRun={(action) => {
            props.onRun(action, null);
          }}
          pending={props.pending}
          summary={box.checks.detail}
        />
      ) : null}
    </>
  );
}

function MergeStateRow({ box, ...props }: MergeBoxProps & { readonly box: OpenBox }) {
  const conflictActions =
    props.overview.merge.state === "conflicts" ? props.slots.anchored.conflict : [];
  return (
    <MergeBoxRow
      actions={
        conflictActions.length === 0 ? null : (
          <View style={styles.actions}>
            {conflictActions.map((action) => (
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
        )
      }
      first={box.checks === null}
      onPress={null}
      row={box.merge}
      testID="pull-request-merge-box-state"
    />
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
    paddingTop: spacing.xs,
    rowGap: spacing.xs,
  },
  box: {
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    overflow: "hidden",
  },
  controls: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.sm,
  },
});

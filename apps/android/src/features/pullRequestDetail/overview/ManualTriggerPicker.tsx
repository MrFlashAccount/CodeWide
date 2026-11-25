import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  type Text as NativeText,
  useWindowDimensions,
  View,
} from "react-native";

import type { CheckTrigger, TriggerRun } from "../../../data/forgeCheckTriggers";
import { AppButton } from "../../../presentation/controls/AppButton";
import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { AppList } from "../../../ui/AppList";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { ChecksSheetHeader } from "./ChecksSheetHeader";
import type { ManualTriggerAccess } from "./ManualTriggersContext";

const WINDOW_SHARE = 0.65;

type PickerProps = {
  readonly access: ManualTriggerAccess;
  readonly commands: readonly CheckTrigger[];
  readonly error: string | null;
  readonly onClose: () => void;
  readonly runs: ReadonlyMap<string, TriggerRun>;
  readonly stale: boolean;
};

type Option = {
  readonly command: CheckTrigger | null;
  readonly id: string;
  readonly label: string;
  readonly result: TriggerRun | null;
};

function optionsFor(
  commands: readonly CheckTrigger[],
  runs: ReadonlyMap<string, TriggerRun>,
): readonly Option[] {
  const rows = new Map<string, Option>();
  for (const command of commands) {
    rows.set(command.actionId, {
      command,
      id: command.actionId,
      label: command.label,
      result: runs.get(command.actionId) ?? null,
    });
  }
  for (const result of runs.values()) {
    if (!rows.has(result.actionId)) {
      rows.set(result.actionId, {
        command: null,
        id: result.actionId,
        label: result.label,
        result,
      });
    }
  }
  return [...rows.values()];
}

function canChoose(row: Option): boolean {
  return (
    row.command?.availability.state === "enabled" &&
    (row.result === null || row.result.progress === "error")
  );
}

function buttonLabel(selected: readonly CheckTrigger[]): string {
  if (selected.length === 1) {
    return selected[0]?.label ?? "Run action";
  }
  return selected.length === 0 ? "Run selected actions" : `Run ${String(selected.length)} actions`;
}

/** A second native sheet window keeps the underlying Checks list's scroll position and disclosure alive. */
export function ManualTriggerPicker({
  access,
  commands,
  error,
  onClose,
  runs,
  stale,
}: PickerProps): React.JSX.Element {
  const { height } = useWindowDimensions();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const rows = optionsFor(commands, runs);
  const available = rows.flatMap((row) =>
    row.command !== null && canChoose(row) ? [row.command] : [],
  );
  const allowed = available.filter((command) => selected.has(command.actionId));
  const allSelected = available.length === allowed.length;
  const toggleAll = useEvent(() => {
    setSelected(allSelected ? new Set() : new Set(available.map((command) => command.actionId)));
  });
  const toggle = useEvent((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  });
  const run = useEvent(() => {
    if (stale || error !== null || allowed.length === 0) {
      return;
    }
    access.resource.run(access.target, allowed, randomUUID).then(
      (complete) => {
        if (complete) {
          onClose();
        }
      },
      () => undefined,
    );
    setSelected(new Set());
  });
  const close = useEvent((open: boolean) => {
    if (!open) {
      onClose();
    }
  });
  const retry = useEvent(() => {
    access.resource.catalog.refresh(access.target).catch(() => undefined);
  });
  const notice = stale ? "The pull request changed. Return to Checks for this revision." : error;
  return (
    <AppSheet contentProps={{ dismissLabel: "Back to checks" }} isOpen onOpenChange={close}>
      <ChecksSheetHeader
        action={
          <SelectionAction
            allSelected={allSelected}
            multiple={!stale && available.length > 1}
            onToggle={toggleAll}
          />
        }
        title="Manual Actions"
      />
      {notice === null ? null : <PickerNotice error={notice} onRetry={stale ? null : retry} />}
      <AppList
        data={rows}
        empty={<Text style={styles.meta}>No manual actions available</Text>}
        extraData={{ selected, stale }}
        keyExtractor={(row) => row.id}
        nestedScrollEnabled
        renderItem={({ item }) => (
          <TriggerOption
            checked={selected.has(item.id) && canChoose(item)}
            disabled={stale || !canChoose(item)}
            onChange={toggle}
            row={item}
          />
        )}
        scrollComponent={AppSheetScrollView}
        style={{ maxHeight: height * WINDOW_SHARE }}
        testID="pull-request-checks-trigger-options"
        virtualized={false}
      />
      <AppButton
        isDisabled={allowed.length === 0 || stale || error !== null}
        onPress={run}
        style={styles.submit}
        testID="pull-request-checks-trigger-run"
      >
        {buttonLabel(allowed)}
      </AppButton>
    </AppSheet>
  );
}

function SelectionAction({
  allSelected,
  multiple,
  onToggle,
}: {
  readonly allSelected: boolean;
  readonly multiple: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element | null {
  if (!multiple) {
    return null;
  }
  return (
    <Pressable accessibilityRole="button" onPress={onToggle} style={styles.selectAll}>
      <Text style={styles.meta}>{allSelected ? "Clear selection" : "Select all"}</Text>
    </Pressable>
  );
}

function PickerNotice({
  error,
  onRetry,
}: {
  readonly error: string;
  readonly onRetry: (() => void) | null;
}): React.JSX.Element {
  return (
    <View style={styles.notice}>
      <Text accessibilityRole="alert" style={styles.error}>
        {error}
      </Text>
      {onRetry === null ? null : (
        <AppButton onPress={onRetry} variant="secondary">
          Retry
        </AppButton>
      )}
    </View>
  );
}

function TriggerOption({
  checked,
  disabled,
  onChange,
  row,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (id: string) => void;
  readonly row: Option;
}): React.JSX.Element {
  const press = useEvent(() => {
    onChange(row.id);
  });
  const detail = optionDetail(row);
  const busy = row.result?.progress === "pending";
  return (
    <Pressable
      accessibilityHint={detail}
      accessibilityLabel={row.label}
      accessibilityRole="checkbox"
      accessibilityState={{ busy, checked, disabled }}
      disabled={disabled}
      onPress={press}
      style={styles.option}
      testID={`pull-request-checks-trigger-option-${row.id}`}
    >
      <Ionicons
        color={disabled ? colors.textDim : colors.text}
        name={checked ? "checkbox" : "square-outline"}
        size={iconSize.action}
      />
      <TriggerLabel busy={busy} detail={detail} row={row} />
    </Pressable>
  );
}

function optionDetail(row: Option): string {
  if (row.result !== null) {
    return row.result.message;
  }
  return row.command?.availability.state === "disabled" ? row.command.availability.reason : "";
}

function TriggerLabel({
  busy,
  detail,
  row,
}: {
  readonly busy: boolean;
  readonly detail: string;
  readonly row: Option;
}): React.JSX.Element {
  const name = useRef<NativeText>(null);
  const failed = row.result?.progress === "error" || row.result?.progress === "unknown";
  return (
    <View style={styles.heading}>
      <Text ref={name} style={styles.name}>
        {row.label}
      </Text>
      <TextShimmer shimmering={busy} target={name} />
      {detail === "" ? null : (
        <Text accessibilityLiveRegion="polite" style={failed ? styles.error : styles.meta}>
          {detail}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    ...typeScale.label,
    color: colors.error,
  },
  heading: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  name: {
    ...typeScale.body,
    color: colors.text,
  },
  notice: {
    paddingVertical: spacing.xs,
  },
  option: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingVertical: spacing.xs,
  },
  selectAll: {
    justifyContent: "center",
    minHeight: controlSize.regular,
  },
  submit: {
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
});

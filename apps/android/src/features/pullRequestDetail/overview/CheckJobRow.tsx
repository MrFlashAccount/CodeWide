import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Linking, Pressable, StyleSheet, type Text as NativeText, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { CheckItem } from "../../../data/forgePullRequestContract";
import { checkViewerUrl } from "../../../data/forgeProviderUrl";
import { useEvent } from "../../../react/useEvent";
import {
  colors,
  controlSize,
  disabledOpacity,
  iconSize,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { OverflowMenuButton } from "../../../ui/OverflowMenuButton";
import { OverflowMenu } from "../../../ui/OverflowMenu";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { ManualTriggerEntry } from "./ManualTriggerControls";
import { checkMetadata, jobStatus } from "./checksSheetRows";

type Props = {
  readonly actions: readonly ActionDescriptor[];
  readonly check: CheckItem;
  readonly host: string;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
};

/** Each row keeps the viewer, manual actions and overflow as independent touch targets. */
export function CheckJobRow(props: Props): React.JSX.Element {
  const { actions, check, host, onRun, pending } = props;
  const url = checkViewerUrl(check, host);
  const allowed = actions.filter(
    (action) =>
      action.kind !== "fixCi" &&
      action.kind !== "setCheckRequired" &&
      (action.kind !== "restartCheck" || action.availability.state === "enabled"),
  );
  const busy = actions.some((action) => pending[action.actionId] === true);
  const choose = useEvent((id: string) => {
    const command = allowed.find((action) => action.actionId === id);
    if (command?.availability.state === "enabled" && pending[id] !== true) {
      onRun(command);
    }
  });
  return (
    <View style={styles.row}>
      {typeof check.required === "boolean" ? (
        <Requirement {...props} checked={check.required} />
      ) : null}
      <JobBody busy={busy} check={check} url={url} />
      <ManualTriggerEntry check={check} />
      {allowed.length > 0 ? (
        <OverflowMenu
          accessibilityLabel={`Actions for ${check.name}`}
          actions={allowed.map((action) => ({
            disabled: action.availability.state === "disabled" || pending[action.actionId] === true,
            id: action.actionId,
            label: action.label,
          }))}
          onSelect={choose}
          size="compact"
          testID={`pull-request-checks-menu-${check.checkId}`}
        />
      ) : (
        <OverflowMenuButton
          accessibilityLabel={`No job actions for ${check.name}`}
          disabled
          size="compact"
        />
      )}
    </View>
  );
}

function JobBody({
  busy,
  check,
  url,
}: {
  readonly busy: boolean;
  readonly check: CheckItem;
  readonly url: string | null;
}): React.JSX.Element {
  const open = useEvent(() => {
    if (url !== null) {
      Linking.openURL(url).catch(() => undefined);
    }
  });
  const status = jobStatus(check);
  const metadata = checkMetadata(check);
  const label = [check.name, status.label, metadata].filter(Boolean).join(", ");
  return url === null ? (
    <View
      accessibilityLabel={label}
      accessible
      style={styles.body}
      testID={`pull-request-checks-job-${check.checkId}`}
    >
      <JobLabel busy={busy} check={check} metadata={metadata} />
    </View>
  ) : (
    <Pressable
      accessibilityHint="Opens job in browser"
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={open}
      style={styles.body}
      testID={`pull-request-checks-job-${check.checkId}`}
    >
      <JobLabel busy={busy} check={check} metadata={metadata} />
    </Pressable>
  );
}

function JobLabel({
  busy,
  check,
  metadata,
}: {
  readonly busy: boolean;
  readonly check: CheckItem;
  readonly metadata: string;
}): React.JSX.Element {
  const status = jobStatus(check);
  const name = useRef<NativeText>(null);
  return (
    <>
      <Text numberOfLines={2} ref={name} style={styles.name}>
        {check.name}
      </Text>
      <View style={styles.status}>
        <Ionicons color={status.color} name={status.icon} size={iconSize.indicator} />
        <Text style={[styles.metadata, { color: status.color }]}>{status.label}</Text>
        {metadata === "" ? null : <Text style={styles.metadata}>{`· ${metadata}`}</Text>}
      </View>
      <TextShimmer shimmering={busy} target={name} />
    </>
  );
}

function Requirement(props: Props & { readonly checked: boolean }): React.JSX.Element {
  const { check, onRun } = props;
  const action = props.actions.find((candidate) => candidate.kind === "setCheckRequired");
  const { busy, disabled, reason, value } = requirementState(action, props);
  const change = useEvent(() => {
    if (action !== undefined && !disabled) {
      onRun(action);
    }
  });
  return (
    <Pressable
      accessibilityHint={reason}
      accessibilityLabel={`${check.name}, required for merge`}
      accessibilityRole="checkbox"
      accessibilityState={{ busy, checked: value, disabled }}
      disabled={disabled}
      onPress={change}
      style={[styles.checkbox, disabled && styles.disabled]}
      testID={`pull-request-checks-required-${check.checkId}`}
    >
      <Ionicons
        color={value ? colors.text : colors.textMuted}
        name={value ? "checkbox" : "square-outline"}
        size={iconSize.action}
      />
    </Pressable>
  );
}

function requirementState(
  action: ActionDescriptor | undefined,
  { checked, pending, pendingToggles }: Props & { readonly checked: boolean },
) {
  if (action === undefined) {
    return {
      busy: false,
      disabled: true,
      reason: "This merge requirement is read-only",
      value: checked,
    };
  }
  const busy = pending[action.actionId] === true;
  return {
    busy,
    disabled: busy || action.availability.state === "disabled",
    reason:
      action.availability.state === "disabled" ? action.availability.reason : "Required for merge",
    value: pendingToggles[action.actionId] ?? action.toggle?.on ?? checked,
  };
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: "center",
    minHeight: controlSize.touch,
    minWidth: 0,
    paddingVertical: spacing.xxs,
  },
  checkbox: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.touch,
    width: controlSize.regular,
  },
  disabled: { opacity: disabledOpacity },
  metadata: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  name: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  row: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch + spacing.xs,
  },
  status: {
    alignItems: "center",
    columnGap: spacing.xxs,
    flexDirection: "row",
  },
});

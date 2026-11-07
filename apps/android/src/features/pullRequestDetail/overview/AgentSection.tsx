import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ThreadId } from "../../../data/reviewContract";
import {
  colors,
  controlHitSlop,
  controlSize,
  disabledOpacity,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import {
  agentRowDetail,
  agentRowIntent,
  agentRowState,
  agentRowStateLabel,
  type AgentRowState,
} from "../actions/agentRowState";
import { useScenarioView } from "../actions/ScenarioViewsContext";
import { overviewStyles } from "./overview.styles";

const PRESSED_OPACITY = 0.72;

/**
 * The Agent section under the PR header: one row per agent scenario the catalog places in
 * the row slot (Review PR, Address comments, Rebase, plugin scenarios), grouped in one
 * outlined block with inset dividers. Each row keeps the plugin's label, shimmering while a
 * start is pending or its run is queued or running, and says on its second line what the
 * run did: `open chat`, its age, the real failure reason, or the catalog's disabled reason.
 * Every start goes through `onRun`, the screen's single scenario path.
 */
export function AgentSection({
  actions,
  nowMs,
  onOpenChat,
  onRun,
  pending,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly nowMs: number;
  /** Opens the run's chat, or the PR's review chat when the run's thread is not known. */
  readonly onOpenChat: (threadId: ThreadId | null) => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
}): React.JSX.Element | null {
  if (actions.length === 0) {
    return null;
  }
  return (
    <View style={styles.section} testID="pull-request-agent-section">
      <Text accessibilityRole="header" style={overviewStyles.sectionHeader}>
        Agent
      </Text>
      <View style={styles.group}>
        {actions.map((action, index) => (
          <AgentActionRow
            action={action}
            divided={index > 0}
            key={action.actionId}
            nowMs={nowMs}
            onOpenChat={onOpenChat}
            onRun={onRun}
            pending={pending[action.actionId] === true}
          />
        ))}
      </View>
    </View>
  );
}

type RowProps = {
  readonly action: ActionDescriptor;
  readonly nowMs: number;
  readonly onOpenChat: (threadId: ThreadId | null) => void;
  readonly onRun: (action: ActionDescriptor) => void;
};

/** One agent action: its body (status icon, label, second line) and the trailing control. */
function AgentActionRow({
  divided,
  pending,
  ...props
}: RowProps & {
  /** Draws the inset divider above every row but the first. */
  readonly divided: boolean;
  readonly pending: boolean;
}): React.JSX.Element {
  const state = agentRowState(props.action, useScenarioView(props.action.actionId), pending);
  return (
    <View style={styles.row}>
      {divided ? <View style={styles.separator} /> : null}
      <RowBody {...props} state={state} />
      <TrailingControl action={props.action} onRun={props.onRun} state={state} />
    </View>
  );
}

/** The row's press target, labelled `<Action>, <state>`; a running row ends in a chevron. */
function RowBody({
  action,
  nowMs,
  onOpenChat,
  onRun,
  state,
}: RowProps & { readonly state: AgentRowState }): React.JSX.Element {
  const intent = agentRowIntent(state);
  const busy = state.kind === "active" || state.kind === "starting";
  const muted = state.kind === "disabled";
  return (
    <Pressable
      accessibilityLabel={`${action.label}, ${agentRowStateLabel(state, nowMs)}`}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: intent.kind === "none" }}
      disabled={intent.kind === "none"}
      onPress={() => {
        if (intent.kind === "openChat") {
          onOpenChat(intent.threadId);
        } else if (intent.kind === "run") {
          onRun(action);
        }
      }}
      style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      testID={`agent-action-${action.actionId}`}
    >
      <Ionicons
        color={ICON_COLORS[state.kind]}
        name={ICONS[state.kind]}
        size={iconSize.action}
        style={muted && styles.muted}
      />
      <View style={styles.text}>
        <Text numberOfLines={1} shimmering={busy} style={[styles.label, muted && styles.muted]}>
          {action.label}
        </Text>
        <RowDetail detail={agentRowDetail(state, nowMs)} />
      </View>
      {state.kind === "active" ? (
        <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
      ) : null}
    </Pressable>
  );
}

function RowDetail({ detail }: { readonly detail: string | null }): React.JSX.Element | null {
  return detail === null ? null : (
    <Text numberOfLines={1} style={styles.detail}>
      {detail}
    </Text>
  );
}

/** Run, Retry or Run again beside the row; a running row has its chevron instead. */
function TrailingControl({
  action,
  onRun,
  state,
}: {
  readonly action: ActionDescriptor;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly state: AgentRowState;
}): React.JSX.Element | null {
  if (state.kind === "active") {
    return null;
  }
  const control = TRAILING[state.kind];
  const disabled = state.kind === "disabled" || state.kind === "starting";
  return (
    <Pressable
      accessibilityLabel={control.accessibilityLabel(action.label)}
      accessibilityRole="button"
      accessibilityState={{ busy: state.kind === "starting", disabled }}
      disabled={disabled}
      hitSlop={controlHitSlop.compact}
      onPress={() => {
        onRun(action);
      }}
      style={({ pressed }) => [
        styles.button,
        state.kind === "disabled" && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}
      testID={`catalog-action-${action.actionId}`}
    >
      <Text numberOfLines={1} style={styles.buttonLabel}>
        {control.label}
      </Text>
    </Pressable>
  );
}

const TRAILING: Readonly<
  Record<
    Exclude<AgentRowState["kind"], "active">,
    {
      readonly accessibilityLabel: (action: string) => string;
      readonly label: string;
    }
  >
> = {
  disabled: { accessibilityLabel: (action) => `Run ${action}`, label: "Run" },
  done: { accessibilityLabel: (action) => `Run ${action} again`, label: "Run again" },
  failed: { accessibilityLabel: (action) => `Retry ${action}`, label: "Retry" },
  idle: { accessibilityLabel: (action) => `Run ${action}`, label: "Run" },
  starting: { accessibilityLabel: (action) => `Run ${action}`, label: "Run" },
};

const ICONS: Readonly<
  Record<AgentRowState["kind"], "alert-circle" | "checkmark-circle" | "sparkles-outline">
> = {
  active: "sparkles-outline",
  disabled: "sparkles-outline",
  done: "checkmark-circle",
  failed: "alert-circle",
  idle: "sparkles-outline",
  starting: "sparkles-outline",
};

const ICON_COLORS: Readonly<Record<AgentRowState["kind"], string>> = {
  active: colors.textMuted,
  disabled: colors.textMuted,
  done: colors.success,
  failed: colors.error,
  idle: colors.textMuted,
  starting: colors.textMuted,
};

const styles = StyleSheet.create({
  body: {
    alignItems: "center",
    alignSelf: "stretch",
    columnGap: spacing.sm,
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  buttonDisabled: {
    opacity: disabledOpacity,
  },
  buttonLabel: {
    ...typeScale.label,
    color: colors.text,
  },
  detail: {
    ...typeScale.label,
    color: colors.textDim,
    fontWeight: typeWeight.regular,
  },
  // Outlined, not filled: the pane frame owns the surface color behind the block.
  group: {
    borderColor: colors.borderSoft,
    borderRadius: radii.medium,
    borderWidth: 1,
    overflow: "hidden",
  },
  label: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  muted: {
    opacity: disabledOpacity,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: controlSize.touch + spacing.xs,
    paddingRight: spacing.compact + spacing.optical,
  },
  section: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  // Inset to the label, as the Changes and Status rows inset theirs.
  separator: {
    backgroundColor: colors.borderSoft,
    height: StyleSheet.hairlineWidth,
    left: spacing.sm + iconSize.action + spacing.sm,
    position: "absolute",
    right: 0,
    top: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});

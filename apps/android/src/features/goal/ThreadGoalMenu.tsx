import type { ThreadGoal, ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";
import { useSelector } from "@legendapp/state/react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { spacing, typeScale } from "../../theme";
import { ContentMenu } from "../../ui/ContentMenu";
import { formatDuration } from "../../ui/number-format";
import { AppText as Text } from "../../ui/Typography";
import { GoalMenuIcon } from "./GoalMenuIcon";
import { useGoalMenu, type GoalMenuCapabilities, type GoalMenuOperation } from "./goalMenu";
import type { GoalMenuAction as GoalMenuActionKind } from "./goalMenuLifecycle";
import { goalLifecycleAction, threadGoalStatusLabel } from "./goalStatus";
import { ThreadGoalChip } from "./ThreadGoalChip";
import { styles } from "./ThreadGoalMenu.styles";

const MAX_MENU_WIDTH = 360;
const MAX_OBJECTIVE_HEIGHT = 200;
// Reserve the icon toolbar, metadata and native popup window insets.
const MENU_CHROME_HEIGHT = 120;
const MILLISECONDS_PER_SECOND = 1000;

/** Anchors goal details and lifecycle actions to the leading composer context chip. */
export function ThreadGoalMenu(props: GoalMenuCapabilities): React.JSX.Element {
  const menu = useGoalMenu(props);
  const open = useSelector(menu.state$.open);
  const window = useWindowDimensions();
  const contentWidth = Math.max(
    1,
    Math.min(MAX_MENU_WIDTH, window.width - spacing.md - spacing.md),
  );
  const objectiveHeight = Math.max(
    1,
    Math.min(MAX_OBJECTIVE_HEIGHT, window.height - MENU_CHROME_HEIGHT),
  );
  const lifecycleAvailable =
    props.captureGoalLifecycle !== undefined &&
    (props.currentTurnId === null || props.onInterrupt !== undefined);
  const trigger = (
    <ThreadGoalChip
      expanded={open}
      goal={props.goal}
      maxWidth={contentWidth}
      onPress={menu.toggleOpen}
    />
  );
  return (
    <View style={styles.anchor}>
      <ContentMenu
        align="center"
        onOpenChange={menu.changeOpen}
        open={open}
        placement="top"
        trigger={trigger}
        width={contentWidth}
      >
        <GoalMenuContent
          goal={props.goal}
          lifecycleAvailable={lifecycleAvailable}
          menu={menu}
          objectiveHeight={objectiveHeight}
        />
      </ContentMenu>
    </View>
  );
}

type GoalMenuContentProps = {
  readonly goal: ThreadGoal;
  readonly lifecycleAvailable: boolean;
  readonly menu: ReturnType<typeof useGoalMenu>;
  readonly objectiveHeight: number;
};

function GoalMenuContent(props: GoalMenuContentProps): React.JSX.Element {
  const operation = useSelector(props.menu.state$.operation);
  const controls = {
    lifecycleAvailable: props.lifecycleAvailable,
    menu: props.menu,
    operation,
    status: props.goal.status,
  };
  return (
    <View testID="thread-goal-menu">
      <GoalMenuHeader controls={controls} />
      <GoalObjective goal={props.goal} menu={props.menu} objectiveHeight={props.objectiveHeight} />
      <GoalMenuMetadata goal={props.goal} operation={operation} />
    </View>
  );
}

function GoalMenuHeader({
  controls: props,
}: {
  readonly controls: GoalMenuControlProps;
}): React.JSX.Element {
  const busy = props.operation.status === "pending";
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.heading}>
        Goal
      </Text>
      <View style={styles.headerActions} testID="goal-menu-actions">
        <GoalMenuLifecycleControl controls={props} />
        <GoalMenuAction
          action="edit"
          disabled={busy}
          label="Edit goal"
          onPress={props.menu.edit}
          pending={false}
        />
        <GoalMenuAction
          action="stop"
          disabled={busy || !props.lifecycleAvailable}
          label="Stop goal"
          onPress={props.menu.stop}
          pending={isPendingAction(props.operation, "stop")}
        />
      </View>
    </View>
  );
}

function GoalObjective(
  props: Pick<GoalMenuContentProps, "goal" | "menu" | "objectiveHeight">,
): React.JSX.Element {
  const measuredHeight = useSelector(props.menu.state$.objectiveHeight);
  // Compose requires an explicit RN scroll viewport. Its size follows measured
  // text, not the cap; only genuinely long objectives occupy the maximum height.
  const height = Math.min(
    measuredHeight > 0 ? measuredHeight : typeScale.body.lineHeight,
    props.objectiveHeight,
  );
  return (
    <View style={styles.section}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onContentSizeChange={props.menu.measureObjective}
        style={{ height }}
        testID="goal-objective-reader"
      >
        {/* Android selectable Text becomes a focus target and can draw native
            focus chrome in the popup. Selection/editing belongs to composer. */}
        <Text selectable={false} style={styles.objective} testID="goal-menu-objective">
          {props.goal.objective}
        </Text>
      </ScrollView>
    </View>
  );
}

function GoalMenuMetadata({
  goal,
  operation,
}: {
  readonly goal: ThreadGoal;
  readonly operation: GoalMenuOperation;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <View style={styles.metadataRow}>
        <Text
          shimmering={operation.status === "pending"}
          style={styles.metadata}
          testID="goal-menu-status"
        >
          {threadGoalStatusLabel(goal.status)}
        </Text>
        <Text style={styles.metadata}>·</Text>
        <Text style={styles.metadata}>
          {formatDuration(goal.timeUsedSeconds * MILLISECONDS_PER_SECOND)}
        </Text>
      </View>
      {operation.status === "error" && (
        <Text accessibilityRole="alert" style={styles.error}>
          {operation.error}
        </Text>
      )}
    </View>
  );
}

type GoalMenuControlProps = {
  readonly lifecycleAvailable: boolean;
  readonly menu: ReturnType<typeof useGoalMenu>;
  readonly operation: GoalMenuOperation;
  readonly status: ThreadGoalStatus;
};

function menuLifecycleStatus(
  operation: GoalMenuOperation,
  status: ThreadGoalStatus,
): ThreadGoalStatus {
  if (operation.status !== "pending" || operation.action === "stop") {
    return status;
  }
  return operation.action === "pause" ? "active" : "paused";
}

function isPendingAction(operation: GoalMenuOperation, action: GoalMenuActionKind): boolean {
  return operation.status === "pending" && operation.action === action;
}

function GoalMenuLifecycleControl({
  controls: props,
}: {
  readonly controls: GoalMenuControlProps;
}): React.JSX.Element | null {
  const action = goalLifecycleAction(menuLifecycleStatus(props.operation, props.status));
  if (action === null) {
    return null;
  }
  const controls = {
    pause: props.menu.pause,
    resume: props.menu.resume,
  } as const;
  return (
    <GoalMenuAction
      action={action.kind}
      disabled={props.operation.status === "pending" || !props.lifecycleAvailable}
      label={action.label}
      onPress={controls[action.kind]}
      pending={isPendingAction(props.operation, action.kind)}
    />
  );
}

function GoalMenuAction({
  action,
  disabled,
  label,
  onPress,
  pending,
}: {
  readonly action: GoalMenuActionKind | "edit";
  readonly disabled: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly pending: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint={
        action === "stop" ? "Removes the goal and interrupts the current response" : undefined
      }
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && styles.actionPressed,
        disabled && !pending && styles.disabled,
      ]}
    >
      <GoalMenuIcon action={action} />
    </Pressable>
  );
}

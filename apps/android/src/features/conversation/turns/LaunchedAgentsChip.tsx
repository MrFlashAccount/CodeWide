import Ionicons from "@expo/vector-icons/Ionicons";
import { useRecyclingState } from "@legendapp/list/react-native";
import { createElement, useContext } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useEvent } from "../../../react/useEvent";
import type { LaunchedAgent } from "../../../rendering/launchedAgents";
import { colors, iconSize } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { AnchoredMenuList } from "../../../ui/AnchoredMenuList";
import { ContentMenu } from "../../../ui/ContentMenu";
import { useAnchoredMenuSize } from "../../../ui/useAnchoredMenuSize";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentChip.styles";
import { SubagentNavigationContext } from "./turnContexts";

/** The chip sits inside a bubble, inside the timeline gutters and bubble padding. */
const BUBBLE_SIDE_INSET = 96;

/**
 * The subagents a finished turn started, as one chip in its bubble: the
 * launch rows sit in the collapsed history. It opens the list; a row opens
 * that agent's thread. Status is not shown: only the running-agents chip
 * knows who still works.
 */
export function LaunchedAgentsChip({
  agents,
}: {
  readonly agents: readonly LaunchedAgent[];
}): React.JSX.Element | null {
  const [open, setOpen] = useRecyclingState(false);
  const menu = useAnchoredMenuSize();
  const window = useWindowDimensions();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const close = useEvent(() => {
    setOpen(false);
  });
  if (agents.length === 0) {
    return null;
  }
  const label =
    agents.length === 1
      ? (agents[0]?.name ?? "Subagent")
      : `${String(agents.length)} agents started`;
  // WHY numeric: Compose measures the anchored trigger intrinsically (a
  // percentage bound collapses its label) and opens the menu at the anchor's
  // start with the menu's width, so anchor and menu share one row width.
  const rowWidth = window.width - BUBBLE_SIDE_INSET;
  const trigger = createElement(LaunchedAgentsTrigger, {
    agents,
    label,
    onPress: toggleOpen,
    open,
    rowWidth,
  });
  const body = (
    <AnchoredMenuList
      maxHeight={menu.maxHeight}
      testID="launched-agents-list"
      title={agents.length === 1 ? "Agent started" : `${String(agents.length)} agents started`}
    >
      {agents.map((agent) => (
        <LaunchedAgentRow agent={agent} key={agent.key} onNavigate={close} />
      ))}
    </AnchoredMenuList>
  );
  return (
    <View style={styles.launchRow}>
      <ContentMenu
        align="start"
        onOpenChange={setOpen}
        open={open}
        placement="bottom"
        trigger={trigger}
        width={rowWidth}
      >
        {body}
      </ContentMenu>
    </View>
  );
}

function LaunchedAgentsTrigger({
  agents,
  label,
  onPress,
  open,
  rowWidth,
}: {
  readonly agents: readonly LaunchedAgent[];
  readonly label: string;
  readonly onPress: () => void;
  readonly open: boolean;
  readonly rowWidth: number;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={[styles.anchorRowStart, { width: rowWidth }]}
      testID="launched-agents-chip"
    >
      {({ pressed }) => (
        <LaunchedAgentsPill agents={agents} label={label} maxWidth={rowWidth} pressed={pressed} />
      )}
    </Pressable>
  );
}

function LaunchedAgentsPill({
  agents,
  label,
  maxWidth,
  pressed,
}: {
  readonly agents: readonly LaunchedAgent[];
  readonly label: string;
  readonly maxWidth: number;
  readonly pressed: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.trigger, { maxWidth }, pressed && styles.pressed]}>
      <AgentAvatarStack badgeOf={() => null} keyOf={(agent) => agent.key} subjects={agents} />
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

function LaunchedAgentRow({
  agent,
  onNavigate,
}: {
  readonly agent: LaunchedAgent;
  readonly onNavigate: () => void;
}): React.JSX.Element {
  const openThread = useContext(SubagentNavigationContext);
  const agentThreadId = agent.agentThreadId;
  const navigates = agentThreadId !== null && openThread !== null;
  const press = useEvent(() => {
    if (agentThreadId === null || openThread === null) {
      return;
    }
    onNavigate();
    openThread(agentThreadId);
  });
  return (
    <Pressable
      accessibilityLabel={navigates ? `Open ${agent.name}` : agent.name}
      accessibilityRole="button"
      disabled={!navigates}
      onPress={press}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="launched-agent-row"
    >
      <AgentAvatar subject={agent} />
      <Text numberOfLines={1} style={[styles.rowName, styles.rowText]}>
        {agent.name}
      </Text>
      {navigates ? (
        <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
      ) : null}
    </Pressable>
  );
}

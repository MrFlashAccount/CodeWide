import Ionicons from "@expo/vector-icons/Ionicons";
import { useRecyclingState } from "@legendapp/list/react-native";
import { createElement, useContext } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useEvent } from "../../../react/useEvent";
import type { LaunchedAgent } from "../../../rendering/launchedAgents";
import { colors, iconSize } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { ContentMenu } from "../../../ui/ContentMenu";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentChip.styles";
import { SubagentNavigationContext } from "./turnContexts";

const MENU_MAX_WIDTH = 400;
const MENU_WIDTH_GUTTER = 24;
const MENU_MAX_HEIGHT = 440;
const MENU_HEIGHT_GUTTER = 96;

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
  const { height, width } = useWindowDimensions();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  if (agents.length === 0) {
    return null;
  }
  const label =
    agents.length === 1
      ? (agents[0]?.name ?? "Subagent")
      : `${String(agents.length)} agents started`;
  const trigger = createElement(LaunchedAgentsTrigger, {
    agents,
    label,
    onPress: toggleOpen,
    open,
  });
  return (
    <View style={styles.launchRow}>
      <ContentMenu
        align="start"
        onOpenChange={setOpen}
        open={open}
        placement="bottom"
        trigger={trigger}
        width={Math.max(1, Math.min(MENU_MAX_WIDTH, width - MENU_WIDTH_GUTTER))}
      >
        <LaunchedAgentsList
          agents={agents}
          maxHeight={Math.max(1, Math.min(MENU_MAX_HEIGHT, height - MENU_HEIGHT_GUTTER))}
          onNavigate={() => {
            setOpen(false);
          }}
        />
      </ContentMenu>
    </View>
  );
}

function LaunchedAgentsList({
  agents,
  maxHeight,
  onNavigate,
}: {
  readonly agents: readonly LaunchedAgent[];
  readonly maxHeight: number;
  readonly onNavigate: () => void;
}): React.JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={styles.list}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      style={{ maxHeight }}
      testID="launched-agents-list"
    >
      <Text accessibilityRole="header" style={styles.listTitle}>
        {agents.length === 1 ? "Agent started" : `${String(agents.length)} agents started`}
      </Text>
      {agents.map((agent) => (
        <LaunchedAgentRow agent={agent} key={agent.key} onNavigate={onNavigate} />
      ))}
    </ScrollView>
  );
}

function LaunchedAgentsTrigger({
  agents,
  label,
  onPress,
  open,
}: {
  readonly agents: readonly LaunchedAgent[];
  readonly label: string;
  readonly onPress: () => void;
  readonly open: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      testID="launched-agents-chip"
    >
      <AgentAvatarStack badgeOf={() => null} keyOf={(agent) => agent.key} subjects={agents} />
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </Pressable>
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
      accessibilityLabel={`Open ${agent.name}`}
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

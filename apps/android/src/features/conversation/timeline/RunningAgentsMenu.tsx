import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useContext, useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useEvent } from "../../../react/useEvent";
import type { RunningAgent } from "../../../rendering/runningAgents";
import { colors, iconSize } from "../../../theme";
import { AgentAvatar, AgentAvatarStack } from "../../../ui/AgentAvatar";
import { ContentMenu } from "../../../ui/ContentMenu";
import { AppText as Text } from "../../../ui/Typography";
import { SubagentNavigationContext } from "../turns/turnContexts";
import { styles } from "./RunningAgentsMenu.styles";

const MENU_MAX_WIDTH = 400;
const MENU_WIDTH_GUTTER = 24;
const MENU_MAX_HEIGHT = 440;
const MENU_HEIGHT_GUTTER = 96;

/**
 * The subagents still working, as one chip above the composer next to the
 * plan: overlapping avatars and a count. It opens the list; a row opens that
 * agent's thread.
 */
export function RunningAgentsMenu({
  agents,
}: {
  readonly agents: readonly RunningAgent[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { height, width } = useWindowDimensions();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const label =
    agents.length === 1 ? (agents[0]?.name ?? "Subagent") : `${String(agents.length)} agents`;
  const trigger = createElement(RunningAgentsTrigger, {
    agents,
    label,
    onPress: toggleOpen,
    open,
  });
  return (
    <ContentMenu
      align="center"
      onOpenChange={setOpen}
      open={open}
      placement="top"
      trigger={trigger}
      width={Math.max(1, Math.min(MENU_MAX_WIDTH, width - MENU_WIDTH_GUTTER))}
    >
      <ScrollView
        contentContainerStyle={styles.list}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: Math.max(1, Math.min(MENU_MAX_HEIGHT, height - MENU_HEIGHT_GUTTER)) }}
        testID="running-agents-list"
      >
        <Text accessibilityRole="header" style={styles.listTitle}>
          Working now
        </Text>
        {agents.map((agent) => (
          <RunningAgentRow
            agent={agent}
            key={agent.agentThreadId}
            onNavigate={() => {
              setOpen(false);
            }}
          />
        ))}
      </ScrollView>
    </ContentMenu>
  );
}

function RunningAgentsTrigger({
  agents,
  label,
  onPress,
  open,
}: {
  readonly agents: readonly RunningAgent[];
  readonly label: string;
  readonly onPress: () => void;
  readonly open: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint="Shows the subagents still working"
      accessibilityLabel={`${label} working`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      testID="running-agents-chip"
    >
      <AgentAvatarStack
        badgeOf={() => "running"}
        keyOf={(agent) => agent.agentThreadId}
        subjects={agents}
      />
      <Text ellipsizeMode="tail" numberOfLines={1} shimmering style={styles.label}>
        {label}
      </Text>
      <Text style={styles.phrase}>working</Text>
      <Ionicons
        color={colors.textDim}
        name={open ? "chevron-down" : "chevron-up"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

function RunningAgentRow({
  agent,
  onNavigate,
}: {
  readonly agent: RunningAgent;
  readonly onNavigate: () => void;
}): React.JSX.Element {
  const openThread = useContext(SubagentNavigationContext);
  const press = useEvent(() => {
    if (openThread === null) {
      return;
    }
    onNavigate();
    openThread(agent.agentThreadId);
  });
  return (
    <Pressable
      accessibilityLabel={`Open ${agent.name}`}
      accessibilityRole="button"
      disabled={openThread === null}
      onPress={press}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="running-agent-row"
    >
      <AgentAvatar badge="running" subject={agent} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} shimmering style={styles.rowName}>
          {agent.name}
        </Text>
      </View>
      {openThread === null ? null : (
        <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
      )}
    </Pressable>
  );
}

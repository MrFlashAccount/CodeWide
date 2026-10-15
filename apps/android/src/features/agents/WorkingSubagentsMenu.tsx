import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useState } from "react";
import { Pressable, View } from "react-native";
import { subagentDisplayName } from "../../data/subagent-projection";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AgentAvatar, AgentAvatarStack, type AgentAvatarSubject } from "../../ui/AgentAvatar";
import { AnchoredMenuList } from "../../ui/AnchoredMenuList";
import { ContentMenu } from "../../ui/ContentMenu";
import { useAnchoredMenuSize } from "../../ui/useAnchoredMenuSize";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./WorkingSubagentsMenu.styles";

type WorkingSubagent = AgentAvatarSubject & { readonly threadId: string };

/**
 * The subagents still working, floating beside the live plan: their avatars
 * and a count; nothing while none works. It opens a list whose rows open that child; a last row opens
 * every subagent. Status comes from the child threads, so a launch alone
 * never reads as a result.
 */
export function WorkingSubagentsMenu({
  onOpen,
  total,
  working,
}: {
  /** Opens the subagents workspace, on one child thread or on all of them (`null`). */
  readonly onOpen: (threadId: string | null) => void;
  readonly total: number;
  readonly working: readonly StoredThreadSummary[];
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const menu = useAnchoredMenuSize();
  const agents = working.map((summary): WorkingSubagent => ({
    kind: "agent",
    name: subagentDisplayName(summary),
    threadId: summary.remoteThreadId,
  }));
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const openChild = useEvent((threadId: string | null) => {
    setOpen(false);
    onOpen(threadId);
  });
  const trigger = createElement(WorkingSubagentsTrigger, {
    agents,
    onPress: toggleOpen,
    open,
  });
  if (agents.length === 0) {
    return null;
  }
  return (
    <ContentMenu
      align="center"
      onOpenChange={setOpen}
      open={open}
      placement="top"
      trigger={trigger}
      width={menu.width}
    >
      <AnchoredMenuList
        maxHeight={menu.maxHeight}
        testID="working-subagents-list"
        title="Working now"
      >
        {agents.map((agent) => (
          <WorkingSubagentRow agent={agent} key={agent.threadId} onOpen={openChild} />
        ))}
        <AllSubagentsRow onOpen={openChild} total={total} />
      </AnchoredMenuList>
    </ContentMenu>
  );
}

function WorkingSubagentsTrigger({
  agents,
  onPress,
  open,
}: {
  readonly agents: readonly WorkingSubagent[];
  readonly onPress: () => void;
  readonly open: boolean;
}): React.JSX.Element {
  const label = `${String(agents.length)} working`;
  return (
    <Pressable
      accessibilityHint="Shows the subagents still working"
      accessibilityLabel={`Agents, ${label}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      testID="working-subagents-chip"
    >
      <AgentAvatarStack
        badgeOf={() => "running"}
        keyOf={(agent) => agent.threadId}
        subjects={agents}
      />
      <Text style={styles.title}>Agents</Text>
      <Text style={styles.divider}>·</Text>
      <Text numberOfLines={1} shimmering style={styles.label}>
        {label}
      </Text>
      <Ionicons
        color={colors.textDim}
        name={open ? "chevron-down" : "chevron-up"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

function WorkingSubagentRow({
  agent,
  onOpen,
}: {
  readonly agent: WorkingSubagent;
  readonly onOpen: (threadId: string | null) => void;
}): React.JSX.Element {
  const press = useEvent(() => {
    onOpen(agent.threadId);
  });
  return (
    <Pressable
      accessibilityLabel={`Open ${agent.name}`}
      accessibilityRole="button"
      onPress={press}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="working-subagent-row"
    >
      <AgentAvatar badge="running" subject={agent} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} shimmering style={styles.rowName}>
          {agent.name}
        </Text>
      </View>
      <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
    </Pressable>
  );
}

function AllSubagentsRow({
  onOpen,
  total,
}: {
  readonly onOpen: (threadId: string | null) => void;
  readonly total: number;
}): React.JSX.Element {
  const press = useEvent(() => {
    onOpen(null);
  });
  return (
    <Pressable
      accessibilityLabel={`All subagents, ${String(total)}`}
      accessibilityRole="button"
      onPress={press}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID="all-subagents-row"
    >
      <Ionicons color={colors.textMuted} name="people-outline" size={iconSize.inline} />
      <View style={styles.rowText}>
        <Text style={styles.rowName}>All subagents · {total}</Text>
      </View>
      <Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />
    </Pressable>
  );
}

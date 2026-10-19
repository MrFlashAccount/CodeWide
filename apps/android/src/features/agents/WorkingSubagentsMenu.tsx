import { createElement, useState } from "react";
import { Pressable, View } from "react-native";
import { subagentDisplayName } from "../../data/subagent-projection";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { AgentAvatar, AgentAvatarStack, type AgentAvatarSubject } from "../../ui/AgentAvatar";
import { AnchoredMenuList, AnchoredMenuRow } from "../../ui/AnchoredMenuList";
import { ContentMenu } from "../../ui/ContentMenu";
import { useAnchoredMenuSize } from "../../ui/useAnchoredMenuSize";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./WorkingSubagentsMenu.styles";

type WorkingSubagent = AgentAvatarSubject & { readonly threadId: string };

/**
 * The subagents still working, floating beside the live plan: their avatars
 * and a count; nothing while none works. It opens the list of those agents,
 * each row opening its child. Status comes from the child threads, so a launch
 * alone never reads as a result.
 */
export function WorkingSubagentsMenu({
  onOpen,
  working,
}: {
  /** Opens the subagents workspace on one child thread. */
  readonly onOpen: (threadId: string) => void;
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
  const openChild = useEvent((threadId: string) => {
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
      <AnchoredMenuList testID="working-subagents-list" title="Working now">
        {agents.map((agent) => (
          <WorkingSubagentRow agent={agent} key={agent.threadId} onOpen={openChild} />
        ))}
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
        surface={colors.surfaceContainerHigh}
      />
      <Text style={styles.title}>Agents</Text>
      <Text style={styles.divider}>·</Text>
      <Text numberOfLines={1} shimmering style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

function WorkingSubagentRow({
  agent,
  onOpen,
}: {
  readonly agent: WorkingSubagent;
  readonly onOpen: (threadId: string) => void;
}): React.JSX.Element {
  const press = useEvent(() => {
    onOpen(agent.threadId);
  });
  return (
    <AnchoredMenuRow
      accessibilityLabel={`Open ${agent.name}`}
      onPress={press}
      testID="working-subagent-row"
    >
      <AgentAvatar badge="running" subject={agent} surface={colors.menuSurface} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} shimmering style={styles.rowName}>
          {agent.name}
        </Text>
      </View>
    </AnchoredMenuRow>
  );
}

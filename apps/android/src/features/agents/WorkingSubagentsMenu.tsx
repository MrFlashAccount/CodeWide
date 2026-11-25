import { createElement } from "react";
import { Pressable, View } from "react-native";
import { subagentDisplayName } from "../../data/subagent-projection";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { AgentAvatar, AgentAvatarStack, type AgentAvatarSubject } from "../../ui/AgentAvatar";
import { AnchoredMenuRow } from "../../ui/AnchoredMenuList";
import { TaskPillPicker } from "../../ui/TaskPillPicker";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./WorkingSubagentsMenu.styles";

type WorkingSubagent = AgentAvatarSubject & { readonly threadId: string };

/**
 * The subagents still working, floating beside the live plan: their avatars
 * and a count. One opens its chat directly; several open a list. Status comes from the child threads, so a launch
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
  const agents = working.map((summary): WorkingSubagent => ({
    kind: "agent",
    name: subagentDisplayName(summary),
    threadId: summary.remoteThreadId,
  }));
  const rows = (close: () => void) =>
    agents.map((agent) => (
      <WorkingSubagentRow agent={agent} close={close} key={agent.threadId} onOpen={onOpen} />
    ));
  return (
    <TaskPillPicker
      entries={agents}
      listTestID="working-subagents-list"
      placement="top"
      renderSingle={(agent) => (
        <SingleWorkingSubagent agent={agent} agents={agents} onOpen={onOpen} />
      )}
      renderTrigger={(open, toggle) =>
        createElement(WorkingSubagentsTrigger, { agents, onPress: toggle, open })
      }
      title="Working now"
    >
      {rows}
    </TaskPillPicker>
  );
}

function SingleWorkingSubagent({
  agent,
  agents,
  onOpen,
}: {
  readonly agent: WorkingSubagent;
  readonly agents: readonly WorkingSubagent[];
  readonly onOpen: (threadId: string) => void;
}): React.JSX.Element {
  const press = useEvent(() => {
    onOpen(agent.threadId);
  });
  return <WorkingSubagentsTrigger agents={agents} onPress={press} open={null} />;
}

function WorkingSubagentsTrigger({
  agents,
  onPress,
  open,
}: {
  readonly agents: readonly WorkingSubagent[];
  readonly onPress: () => void;
  readonly open: boolean | null;
}): React.JSX.Element {
  const label = `${String(agents.length)} working`;
  return (
    <Pressable
      accessibilityHint={
        open === null ? "Opens the working subagent’s chat" : "Shows the subagents still working"
      }
      accessibilityLabel={`Agents, ${label}`}
      accessibilityRole="button"
      accessibilityState={open === null ? {} : { expanded: open }}
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
  close,
  onOpen,
}: {
  readonly agent: WorkingSubagent;
  readonly close: () => void;
  readonly onOpen: (threadId: string) => void;
}): React.JSX.Element {
  const press = useEvent(() => {
    close();
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

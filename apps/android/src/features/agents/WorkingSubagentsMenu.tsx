import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
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

/** Opens the subagents workspace, optionally on one child thread. */
export type SubagentOpener = (
  summaries: readonly StoredThreadSummary[],
  initialThreadId: string | null,
) => void;

/** The chip leaves room for the neighbouring composer chips. */
const TRIGGER_WIDTH_SHARE = 0.6;
/**
 * Compose opens the menu at the chip's start, or ends it at the chip's end
 * when that does not fit; a chip deep in the composer row needs a narrow menu.
 */
const MENU_MAX_WIDTH = 320;

type WorkingSubagent = AgentAvatarSubject & { readonly threadId: string };

/**
 * The subagents still working, as the composer's subagent chip: their
 * avatars and a count. It opens a list whose rows open that child; a last
 * row opens every subagent.
 */
export function WorkingSubagentsMenu({
  onOpen,
  summaries,
  total,
  working,
}: {
  readonly onOpen: SubagentOpener;
  readonly summaries: readonly StoredThreadSummary[];
  readonly total: number;
  readonly working: readonly StoredThreadSummary[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menu = useAnchoredMenuSize();
  const window = useWindowDimensions();
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
    onOpen(summaries, threadId);
  });
  const trigger = createElement(WorkingSubagentsTrigger, {
    agents,
    // WHY numeric: Compose measures the anchored trigger intrinsically; a
    // percentage bound collapses its label to nothing.
    maxWidth: Math.round(window.width * TRIGGER_WIDTH_SHARE),
    onPress: toggleOpen,
    open,
    total,
  });
  return (
    <ContentMenu
      align="start"
      onOpenChange={setOpen}
      open={open}
      placement="top"
      trigger={trigger}
      width={Math.min(menu.width, MENU_MAX_WIDTH)}
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
  maxWidth,
  onPress,
  open,
  total,
}: {
  readonly agents: readonly WorkingSubagent[];
  readonly maxWidth: number;
  readonly onPress: () => void;
  readonly open: boolean;
  readonly total: number;
}): React.JSX.Element {
  const label = `${String(agents.length)} working`;
  return (
    <Pressable
      accessibilityHint="Shows the subagents still working"
      accessibilityLabel={`Subagents: ${label} of ${String(total)}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, { maxWidth }, pressed && styles.pressed]}
      testID="working-subagents-chip"
    >
      <AgentAvatarStack
        badgeOf={() => "running"}
        keyOf={(agent) => agent.threadId}
        subjects={agents}
      />
      <Text numberOfLines={1} shimmering style={styles.label}>
        {label}
      </Text>
      <Text style={styles.total}>· {total}</Text>
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

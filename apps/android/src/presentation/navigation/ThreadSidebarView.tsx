import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget } from "../../theme";
import type { UsageAccountViewModel } from "../usage/UsagePopoverView";
import { UsagePopoverView } from "../usage/UsagePopoverView";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationText as Text } from "../text/ProductText";
import { ThreadListView, type ThreadListRow, type ThreadListVoiceControl } from "./ThreadListView";
import { useEvent } from "../../react/useEvent";

interface ThreadSidebarViewProps {
  connectionState: string;
  onChangeQuery?(query: string): void;
  onNewThread(): void;
  onOpen(id: string): void;
  query?: string;
  rows: ThreadListRow[];
  selectedId?: string;
  title: ReactNode;
  usageAccounts?: readonly UsageAccountViewModel[];
  voice?: ThreadListVoiceControl;
}

interface HeaderActionProps {
  label: string;
  name: "back" | "create" | "more";
  onPress?(): void;
}

export function ThreadSidebarView({
  connectionState,
  onChangeQuery,
  onNewThread,
  onOpen,
  query,
  rows,
  selectedId,
  title,
  usageAccounts,
  voice,
}: ThreadSidebarViewProps): React.JSX.Element {
  const connecting = connectionState !== "live";
  const [archived, setArchived] = useState(false);
  const archivedCount = rows.filter((row) => row.archived === true).length;
  const visibleRows = rows.filter((row) => (row.archived === true) === archived);
  const backToThreads = useEvent(() => setArchived(false));
  const openArchived = useEvent(() => setArchived(true));
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {archived ? (
          <>
            <HeaderAction label="Back to threads" name="back" onPress={backToThreads} />
            <View style={styles.titleSlot}>
              <Text numberOfLines={1} style={styles.title}>
                Archived threads
              </Text>
              <Text style={styles.subtitle}>
                {archivedCount === 1 ? "1 thread" : `${archivedCount} threads`}
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.titleSlot}>
              {typeof title === "string" ? (
                <Text numberOfLines={1} style={styles.title}>
                  {title}
                </Text>
              ) : (
                title
              )}
            </View>
            {connecting && typeof title === "string" ? (
              <ActivityIndicator color={colors.amber} size={14} />
            ) : null}
            <HeaderAction label="New thread" name="create" onPress={onNewThread} />
            <UsagePopoverView
              {...(usageAccounts === undefined ? {} : { accounts: usageAccounts })}
              actions={[
                {
                  description: archivedCount === 1 ? "1 thread" : `${archivedCount} threads`,
                  icon: "archive",
                  id: "archived",
                  label: "Archived threads",
                  onPress: openArchived,
                },
              ]}
              align="end"
              placement="bottom"
              triggerAccessibilityLabel="Thread list menu"
              triggerStyle={headerActionStyle}
            >
              <PresentationIcon color={colors.text} name="more" size={21} />
            </UsagePopoverView>
          </>
        )}
      </View>
      <ThreadListView
        onOpen={onOpen}
        rows={visibleRows}
        showSections={!archived}
        {...(onChangeQuery === undefined ? {} : { onChangeQuery })}
        {...(query === undefined ? {} : { query })}
        {...(selectedId === undefined ? {} : { selectedId })}
        {...(voice === undefined ? {} : { voice })}
      />
    </View>
  );
}

function HeaderAction({ label, name, onPress }: HeaderActionProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={headerActionStyle}
    >
      <PresentationIcon color={colors.text} name={name} size={21} />
    </Pressable>
  );
}

function headerActionStyle({ pressed }: PressableStateCallbackType) {
  return [styles.action, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: touchTarget,
    paddingLeft: spacing.sm,
    paddingRight: 0,
    transform: [{ translateY: spacing.xs }],
  },
  pressed: { opacity: 0.68 },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  title: { color: colors.text, fontSize: 18, fontWeight: "700", lineHeight: 24 },
  subtitle: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  titleSlot: { flex: 1, minWidth: 0, transform: [{ translateY: -0.5 }] },
});

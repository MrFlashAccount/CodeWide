import { useState, type ReactNode } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import type { UsageAccountViewModel, UsagePopoverActionViewModel } from "../usage/UsagePopoverView";
import { UsagePopoverView } from "../usage/UsagePopoverView";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationText as Text } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import {
  ThreadListView,
  type ThreadListPagingControl,
  type ThreadListRow,
  type ThreadListRowActions,
  type ThreadListVoiceControl,
} from "./ThreadListView";
import { useEvent } from "../../../react/useEvent";

type ThreadListPartition = "active" | "archived";

interface ThreadSidebarPagingControl {
  active: Omit<ThreadListPagingControl, "loadMore">;
  archived: Omit<ThreadListPagingControl, "loadMore">;
  loadMore(partition: ThreadListPartition): Promise<void>;
}

interface ThreadSidebarViewProps {
  actions?: ThreadListRowActions;
  connectionState: string;
  onActionError?(message: string): void;
  onChangeQuery?(query: string): void;
  onNewThread(): void;
  onOpen(id: string): void;
  onPrewarm?(id: string): void;
  paging?: ThreadSidebarPagingControl;
  query?: string;
  rows: ThreadListRow[];
  selectedId?: string;
  title: ReactNode;
  usageAccounts?: readonly UsageAccountViewModel[];
  usageActions?: readonly UsagePopoverActionViewModel[];
  voice?: ThreadListVoiceControl;
}

interface HeaderActionProps {
  label: string;
  name: "back" | "create" | "more";
  onPress?(): void;
}

export function ThreadSidebarView(props: ThreadSidebarViewProps): React.JSX.Element {
  const {
    actions,
    connectionState,
    onActionError,
    onChangeQuery,
    onNewThread,
    onOpen,
    onPrewarm,
    paging,
    query,
    rows,
    selectedId,
    title,
    usageAccounts,
    usageActions,
    voice,
  } = props;
  const connecting = connectionState !== "live";
  const [archived, setArchived] = useState(false);
  const archivedCount = rows.filter((row) => row.archived === true).length;
  const visibleRows = rows.filter((row) => (row.archived === true) === archived);
  const backToThreads = useEvent(() => setArchived(false));
  const openArchived = useEvent(() => setArchived(true));
  const loadMore = useEvent(async (): Promise<void> => {
    await paging?.loadMore(archived ? "archived" : "active");
  });
  const partitionPaging = paging?.[archived ? "archived" : "active"];
  const listPaging =
    partitionPaging === undefined
      ? undefined
      : {
          canLoadMore: partitionPaging.canLoadMore,
          error: partitionPaging.error,
          loading: partitionPaging.loading,
          loadMore,
          ...(partitionPaging.loadingLabel === undefined
            ? {}
            : { loadingLabel: partitionPaging.loadingLabel }),
        };
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
                connecting ? (
                  <ShimmerText
                    containerStyle={styles.titleShimmer}
                    style={styles.title}
                    text={title}
                  />
                ) : (
                  <Text numberOfLines={1} style={styles.title}>
                    {title}
                  </Text>
                )
              ) : (
                title
              )}
            </View>
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
                ...(usageActions ?? []),
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
        {...(onPrewarm === undefined ? {} : { onPrewarm })}
        rows={visibleRows}
        showSections={!archived}
        {...(actions === undefined ? {} : { actions })}
        {...(onActionError === undefined ? {} : { onActionError })}
        {...(listPaging === undefined ? {} : { paging: listPaging })}
        {...(onChangeQuery === undefined ? {} : { onChangeQuery })}
        {...(query === undefined ? {} : { query })}
        {...(selectedId === undefined ? {} : { selectedId })}
        {...(voice === undefined ? {} : { voice })}
      />
    </View>
  );
}

function HeaderAction(props: HeaderActionProps): React.JSX.Element {
  const { label, name, onPress } = props;
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

function headerActionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
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
    gap: spacing.optical,
    minHeight: 56,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    transform: [{ translateY: spacing.xxs }],
  },
  pressed: { opacity: 0.68 },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  title: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold },
  subtitle: { color: colors.textMuted, ...typeScale.label },
  titleSlot: { flex: 1, minWidth: 0, transform: [{ translateY: -0.5 }] },
  titleShimmer: { alignSelf: "stretch" },
});

import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import type { ThreadHistoryModel } from "../../data/thread-history-model";
import { projectLabel } from "../../data/thread-projects";
import type { NewChatWorkspaceMode, WorkspaceSupport } from "../../data/workspace-creation";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { ThreadHistoryEmptyState } from "./ConversationHistoryStatus";

export function ConversationEmptyState({
  threadSearchActive,
  emptyRemoteThread,
  cwd,
  openProjectPicker,
  workspaceSupport,
  onChangeWorkspaceMode,
  workspaceMode,
  historyActivityModel,
  historyActivityResourceId,
}: {
  threadSearchActive: boolean;
  emptyRemoteThread: boolean;
  cwd: string;
  openProjectPicker: () => void;
  workspaceSupport: WorkspaceSupport | null;
  onChangeWorkspaceMode: ((mode: NewChatWorkspaceMode) => void) | undefined;
  workspaceMode: NewChatWorkspaceMode;
  historyActivityModel: ThreadHistoryModel | null;
  historyActivityResourceId: string | null;
}) {
  return (
    <View style={styles.emptyConversation}>
      {emptyRemoteThread && !threadSearchActive ? (
        <View testID="new-chat-empty-state" style={styles.newChatEmptyState}>
          <Text style={styles.newChatPrompt}>What would you like to work on?</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change project, currently ${projectLabel(cwd) || "server default"}`}
            onPress={openProjectPicker}
            style={({ pressed }) => [styles.newChatProjectButton, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.newChatProjectText}>
              in {projectLabel(cwd) || "server default"}
            </Text>
            <InlineIcon name="chevron-down" role="label" color={colors.accent} />
          </Pressable>
          {workspaceSupport !== null && onChangeWorkspaceMode !== undefined ? (
            <ActionMenu
              accessibilityLabel="Choose workspace mode"
              actions={[
                {
                  id: "current",
                  section: "Workspace",
                  label: "In this folder",
                  description: "Use the selected project directly",
                  icon: "folder-outline",
                  selected: workspaceMode === "current",
                },
                {
                  id: "isolated",
                  section: "Workspace",
                  label: "New workspace",
                  description: `Create an isolated ${workspaceSupport.displayName}`,
                  icon: "git-branch-outline",
                  selected: workspaceMode === "isolated",
                },
              ]}
              placement="bottom"
              align="center"
              onSelect={(id) => {
                if (id === "current" || id === "isolated") onChangeWorkspaceMode(id);
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Workspace mode, ${workspaceMode === "isolated" ? "new workspace" : "in this folder"}`}
                style={({ pressed }) => [styles.newChatWorkspaceButton, pressed && styles.pressed]}
              >
                <Ionicons
                  name={workspaceMode === "isolated" ? "git-branch-outline" : "folder-outline"}
                  size={iconSize.inline}
                  color={colors.textMuted}
                />
                <Text style={styles.newChatWorkspaceText}>
                  {workspaceMode === "isolated" ? "New workspace" : "In this folder"}
                </Text>
                <InlineIcon name="chevron-down" role="label" color={colors.textMuted} />
              </Pressable>
            </ActionMenu>
          ) : null}
        </View>
      ) : (
        <ThreadHistoryEmptyState
          model={historyActivityModel}
          resourceId={historyActivityResourceId}
          threadSearchActive={threadSearchActive}
        />
      )}
    </View>
  );
}

export function ConversationSelectionPlaceholder() {
  return (
    <View style={styles.emptyConversation}>
      <Ionicons name="chatbubbles-outline" size={iconSize.illustration} color={colors.textDim} />
      <Text style={styles.emptyText}>Select a thread</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    color: colors.textMuted,
    ...typeScale.title,
  },
  pressed: { opacity: 0.68 },
  emptyConversation: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.conversationSurface,
  },
  newChatEmptyState: {
    maxWidth: 520,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  newChatPrompt: {
    color: colors.text,
    ...typeScale.heading,
    textAlign: "center",
  },
  newChatProjectButton: {
    maxWidth: "100%",
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.large,
  },
  newChatProjectText: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.accent,
    ...typeScale.title,
  },
  newChatWorkspaceButton: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.large,
  },
  newChatWorkspaceText: {
    color: colors.textMuted,
    ...typeScale.body,
  },
});

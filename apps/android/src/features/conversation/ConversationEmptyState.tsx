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
  cwd,
  emptyRemoteThread,
  historyActivityModel,
  historyActivityResourceId,
  onChangeWorkspaceMode,
  openProjectPicker,
  threadSearchActive,
  workspaceMode,
  workspaceSupport,
}: {
  cwd: string;
  emptyRemoteThread: boolean;
  historyActivityModel: ThreadHistoryModel | null;
  historyActivityResourceId: string | null;
  onChangeWorkspaceMode: ((mode: NewChatWorkspaceMode) => void) | undefined;
  openProjectPicker: () => void;
  threadSearchActive: boolean;
  workspaceMode: NewChatWorkspaceMode;
  workspaceSupport: WorkspaceSupport | null;
}) {
  const project = projectLabel(cwd);
  const projectDescription = project === "" ? "server default" : project;
  return (
    <View style={styles.emptyConversation}>
      {emptyRemoteThread && !threadSearchActive ? (
        <View style={styles.newChatEmptyState} testID="new-chat-empty-state">
          <Text style={styles.newChatPrompt}>What would you like to work on?</Text>
          <Pressable
            accessibilityLabel={`Change project, currently ${projectDescription}`}
            accessibilityRole="button"
            onPress={openProjectPicker}
            style={({ pressed }) => [styles.newChatProjectButton, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.newChatProjectText}>
              in {projectDescription}
            </Text>
            <InlineIcon color={colors.accent} name="chevron-down" role="label" />
          </Pressable>
          {workspaceSupport !== null && onChangeWorkspaceMode !== undefined ? (
            <ActionMenu
              accessibilityLabel="Choose workspace mode"
              actions={[
                {
                  description: "Use the selected project directly",
                  icon: "folder-outline",
                  id: "current",
                  label: "In this folder",
                  section: "Workspace",
                  selected: workspaceMode === "current",
                },
                {
                  description: `Create an isolated ${workspaceSupport.displayName}`,
                  icon: "git-branch-outline",
                  id: "isolated",
                  label: "New workspace",
                  section: "Workspace",
                  selected: workspaceMode === "isolated",
                },
              ]}
              align="center"
              onSelect={(id) => {
                if (id === "current" || id === "isolated") {
                  onChangeWorkspaceMode(id);
                }
              }}
              placement="bottom"
            >
              <Pressable
                accessibilityLabel={`Workspace mode, ${workspaceMode === "isolated" ? "new workspace" : "in this folder"}`}
                accessibilityRole="button"
                style={({ pressed }) => [styles.newChatWorkspaceButton, pressed && styles.pressed]}
              >
                <Ionicons
                  color={colors.textMuted}
                  name={workspaceMode === "isolated" ? "git-branch-outline" : "folder-outline"}
                  size={iconSize.inline}
                />
                <Text style={styles.newChatWorkspaceText}>
                  {workspaceMode === "isolated" ? "New workspace" : "In this folder"}
                </Text>
                <InlineIcon color={colors.textMuted} name="chevron-down" role="label" />
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
      <Ionicons color={colors.textDim} name="chatbubbles-outline" size={iconSize.illustration} />
      <Text style={styles.emptyText}>Select a thread</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyConversation: {
    alignItems: "center",
    backgroundColor: colors.conversationSurface,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
  },
  emptyText: {
    color: colors.textMuted,
    ...typeScale.title,
  },
  newChatEmptyState: {
    alignItems: "center",
    gap: spacing.xs,
    justifyContent: "center",
    maxWidth: 520,
    paddingHorizontal: spacing.lg,
  },
  newChatProjectButton: {
    alignItems: "center",
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  newChatProjectText: {
    color: colors.accent,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.title,
  },
  newChatPrompt: {
    color: colors.text,
    ...typeScale.heading,
    textAlign: "center",
  },
  newChatWorkspaceButton: {
    alignItems: "center",
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  newChatWorkspaceText: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  pressed: { opacity: 0.68 },
});

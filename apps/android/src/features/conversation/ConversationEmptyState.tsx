import { Ionicons } from "@expo/vector-icons";
import { useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type Text as NativeText } from "react-native";
import type { ThreadHistoryModel } from "../../data/thread-history-model";
import { projectLabel } from "../../data/thread-projects";
import type { NewChatWorkspaceMode, WorkspaceSupport } from "../../data/workspace-creation";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { InlineIcon } from "../../ui/InlineIcon";
import { surfaceToneCanvasStyle, useSurfaceTone } from "../../ui/surfaceTone";
import { TextShimmer } from "../../ui/TextShimmer";
import { AppText as Text } from "../../ui/Typography";
import type { ServerIconId } from "../../data/serverIcons";
import { ServerIcon } from "../connections/ServerIcon";
import { ThreadHistoryEmptyState } from "./ConversationHistoryStatus";

export function ConversationEmptyState({
  cwd,
  historyActivityModel,
  historyActivityResourceId,
  newChat,
  notice = null,
  onChangeWorkspaceMode,
  openProjectPicker,
  projectRequirement = "none",
  server,
  threadSearchActive,
  workspaceMode,
  workspaceSupport,
}: {
  cwd: string;
  historyActivityModel: ThreadHistoryModel | null;
  historyActivityResourceId: string | null;
  newChat: boolean;
  /** The draft host's notice, shown under the project control. */
  notice?: ReactNode;
  onChangeWorkspaceMode: ((mode: NewChatWorkspaceMode) => void) | undefined;
  openProjectPicker: () => void;
  /**
   * Without a server default the control asks for the project sending requires; while the host
   * is finding a suggestion that request shimmers in place.
   */
  projectRequirement?: "none" | "required" | "suggesting";
  /** The new chat's server, shown before its project while several servers are offered. */
  server?: { readonly iconId: ServerIconId; readonly name: string } | undefined;
  threadSearchActive: boolean;
  workspaceMode: NewChatWorkspaceMode;
  workspaceSupport: WorkspaceSupport | null;
}) {
  const project = projectLabel(cwd);
  const projectDescription = project === "" ? "server default" : project;
  const projectText = useRef<NativeText>(null);
  const projectRequired = projectRequirement !== "none";
  const projectAccessibilityLabel = projectRequired
    ? "Choose a project. Sending starts after you choose one"
    : `Change project, currently ${projectDescription}${server === undefined ? "" : ` on ${server.name}`}`;
  // A host pane on the recessed workspace frame keeps the empty transcript in the frame color.
  const canvas = surfaceToneCanvasStyle(useSurfaceTone());
  return (
    <View style={[styles.emptyConversation, canvas]} testID="conversation-empty-state">
      {newChat && !threadSearchActive ? (
        <View style={styles.newChatEmptyState} testID="new-chat-empty-state">
          <Text style={styles.newChatPrompt}>What would you like to work on?</Text>
          <Pressable
            accessibilityLabel={projectAccessibilityLabel}
            accessibilityRole="button"
            onPress={openProjectPicker}
            style={({ pressed }) => [styles.newChatProjectButton, pressed && styles.pressed]}
          >
            {server !== undefined && (
              <View testID="new-chat-project-server">
                <ServerIcon iconId={server.iconId} metric="body" />
              </View>
            )}
            <Text numberOfLines={1} ref={projectText} style={styles.newChatProjectText}>
              {projectRequired ? "Choose a project to start" : `in ${projectDescription}`}
            </Text>
            <TextShimmer shimmering={projectRequirement === "suggesting"} target={projectText} />
            <InlineIcon color={colors.accent} name="chevron-down" role="label" />
          </Pressable>
          {/* The workspace inspection resolves after the screen appears; a fixed slot keeps the centered block from moving when it does. */}
          <View style={styles.newChatWorkspaceSlot} testID="new-chat-workspace-slot">
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
                  style={({ pressed }) => [
                    styles.newChatWorkspaceButton,
                    pressed && styles.pressed,
                  ]}
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
          {notice}
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
    <View
      style={[styles.emptyConversation, styles.selectionPlaceholder]}
      testID="conversation-selection-placeholder"
    >
      <Ionicons color={colors.textDim} name="chatbubbles-outline" size={iconSize.illustration} />
      <Text style={styles.emptyText}>Select a chat</Text>
      <Text style={styles.emptyDescription}>
        Choose a conversation from the list to open it here.
      </Text>
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
  emptyDescription: {
    color: colors.textDim,
    textAlign: "center",
    ...typeScale.body,
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
  newChatWorkspaceSlot: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
  },
  newChatWorkspaceText: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  pressed: { opacity: 0.68 },
  selectionPlaceholder: { padding: spacing.lg },
});

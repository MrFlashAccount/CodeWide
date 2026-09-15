import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { useCodeReviewState } from "./codeReviewState";
import { styles } from "./CodeReviewWorkspace.styles";
import { shortPath } from "./reviewLocation";

import { changeScopeTitle } from "../../rendering/change-menu";
import { changedFileDisplayPath } from "../../rendering/changed-file-path";
import { CodeReviewEditor } from "../../rendering/CodeReviewEditor";
import { colors, iconSize } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { AppText as Text } from "../../ui/Typography";

/** Composes file selection, diff viewing, and review-comment submission. */
export function CodeReviewWorkspace(props: CodeReviewWorkspaceProps) {
  const { cwd, scopeLabel } = props;
  const {
    setWorkspaceWidth,
    close,
    setSidebarPreference,
    sidebarOpen,
    effectiveSelectedPath,
    changeScope,
    changes,
    comments,
    documentStatus,
    menuActions,
    selectMenuAction,
    scopeLoading,
    attachDisabled,
    attach,
    attaching,
    compact,
    document,
    loading,
    loadError,
    reviewFiles,
    workspaceRevision,
    wrapLines,
    effectiveMode,
    selectedReference,
    revealReference,
    commentDraft,
    voiceResource,
    microphoneAccess,
    selectLine,
    updateCommentDraft,
    selectionRef,
    addComment,
    pressVoice,
    selectFile,
    setComments,
  } = useCodeReviewState(props);

  return (
    <View
      testID="code-review-workspace"
      style={styles.root}
      onLayout={({ nativeEvent }) => setWorkspaceWidth(Math.floor(nativeEvent.layout.width))}
    >
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close code review" onPress={close} style={styles.iconButton}>
          <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityLabel="Toggle files"
          onPress={() => setSidebarPreference(!sidebarOpen)}
          style={styles.iconButton}
        >
          <Ionicons name="folder-open-outline" size={iconSize.action} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.title}>
            {effectiveSelectedPath === null
              ? "Code review"
              : changedFileDisplayPath(effectiveSelectedPath, cwd, 72)}
          </Text>
          <View style={styles.subtitleRow}>
            <Text numberOfLines={1} style={styles.subtitle}>
              {scopeLabel ?? changeScopeTitle(changeScope)} · {changes.length} files ·{" "}
              {comments.length} comments
            </Text>
            {documentStatus !== null && (
              <Text
                accessibilityLabel={`File status: ${documentStatus}`}
                numberOfLines={1}
                style={styles.documentStatus}
              >
                · {documentStatus}
              </Text>
            )}
          </View>
        </View>
        <ActionMenu
          accessibilityLabel="Changes options"
          actions={menuActions}
          placement="bottom"
          align="end"
          onSelect={selectMenuAction}
        >
          <Pressable
            accessibilityLabel="Changes options"
            disabled={scopeLoading}
            style={styles.iconButton}
          >
            {scopeLoading ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.text} />
            )}
          </Pressable>
        </ActionMenu>
        <Pressable
          accessibilityLabel="Attach review"
          disabled={attachDisabled}
          onPress={() => void attach()}
          style={[
            styles.attachButton,
            !attachDisabled && styles.attachButtonReady,
            compact && styles.attachButtonCompact,
            attachDisabled && styles.disabled,
          ]}
        >
          {attaching ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Ionicons
              name="attach"
              size={iconSize.action}
              color={attachDisabled ? colors.textDim : colors.text}
            />
          )}
          {!compact && <Text style={styles.attachButtonText}>Attach {comments.length || ""}</Text>}
        </Pressable>
      </View>

      <View style={styles.workspace}>
        <View style={styles.editorPane}>
          <CodeReviewEditor
            document={document}
            loading={loading}
            loadError={loadError}
            files={reviewFiles}
            workspaceRevision={workspaceRevision}
            selectedPath={effectiveSelectedPath}
            sidebarOpen={sidebarOpen}
            compact={compact}
            wrapLines={wrapLines}
            mode={effectiveMode}
            comments={comments}
            selectedReference={selectedReference}
            revealReference={selectedReference === null ? revealReference : null}
            commentDraft={commentDraft}
            voicePhase={voiceResource?.phase ?? "idle"}
            voicePermissionGranted={microphoneAccess.granted}
            voiceRetryAvailable={voiceResource?.retryAvailable ?? false}
            voiceError={voiceResource?.error ?? null}
            onLinePress={selectLine}
            onCommentDraftChange={updateCommentDraft}
            onCommentSelectionChange={(selection) => {
              selectionRef.current = selection;
            }}
            onCommentSubmit={addComment}
            onVoicePress={(draft, selection) => void pressVoice(draft, selection)}
            onFileSelect={(path) => {
              const change = changes.find((candidate) => candidate.path === path);
              if (change !== undefined) selectFile(change);
            }}
          />
          {comments.length > 0 && (
            <ScrollView
              horizontal
              style={styles.commentStrip}
              contentContainerStyle={styles.commentStripContent}
              keyboardShouldPersistTaps="handled"
            >
              {comments.map((comment) => (
                <View key={comment.id} style={styles.commentChip}>
                  <Text numberOfLines={1} style={styles.commentChipLocation}>
                    {shortPath(comment.path)}:{comment.line}
                  </Text>
                  <Text numberOfLines={1} style={styles.commentChipBody}>
                    {comment.body}
                  </Text>
                  <Pressable
                    accessibilityLabel="Delete comment"
                    hitSlop={8}
                    onPress={() =>
                      setComments((current) =>
                        current.filter((candidate) => candidate.id !== comment.id),
                      )
                    }
                  >
                    <Ionicons name="close-circle" size={iconSize.inline} color={colors.textDim} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

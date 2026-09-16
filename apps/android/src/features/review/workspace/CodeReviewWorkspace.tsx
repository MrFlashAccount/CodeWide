import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { useCodeReviewState } from "./codeReviewState";
import { styles } from "./CodeReviewWorkspace.styles";
import { shortPath } from "../resources/reviewLocation";

import { changeScopeTitle } from "../../../rendering/change-menu";
import { changedFileDisplayPath } from "../../../rendering/changed-file-path";
import { CodeReviewEditor } from "../editor/CodeReviewEditor";
import { colors, iconSize } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text } from "../../../ui/Typography";

/** Composes file selection, diff viewing, and review-comment submission. */
export function CodeReviewWorkspace(props: CodeReviewWorkspaceProps) {
  const { cwd, scopeLabel } = props;
  const {
    addComment,
    attach,
    attachDisabled,
    attaching,
    changes,
    changeScope,
    close,
    commentDraft,
    comments,
    compact,
    document,
    documentStatus,
    effectiveMode,
    effectiveSelectedPath,
    loadError,
    loading,
    menuActions,
    microphoneAccess,
    pressVoice,
    revealReference,
    reviewFiles,
    scopeLoading,
    selectedReference,
    selectFile,
    selectionRef,
    selectLine,
    selectMenuAction,
    setComments,
    setSidebarPreference,
    setWorkspaceWidth,
    sidebarOpen,
    updateCommentDraft,
    voiceResource,
    workspaceRevision,
    wrapLines,
  } = useCodeReviewState(props);

  return (
    <View
      onLayout={({ nativeEvent }) => {
        setWorkspaceWidth(Math.floor(nativeEvent.layout.width));
      }}
      style={styles.root}
      testID="code-review-workspace"
    >
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close code review" onPress={close} style={styles.iconButton}>
          <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
        </Pressable>
        <Pressable
          accessibilityLabel="Toggle files"
          onPress={() => {
            setSidebarPreference(!sidebarOpen);
          }}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="folder-open-outline" size={iconSize.action} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.title}>
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
          align="end"
          onSelect={selectMenuAction}
          placement="bottom"
        >
          <Pressable
            accessibilityLabel="Changes options"
            disabled={scopeLoading}
            style={styles.iconButton}
          >
            {scopeLoading ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Ionicons color={colors.text} name="ellipsis-vertical" size={iconSize.action} />
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
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Ionicons
              color={attachDisabled ? colors.textDim : colors.text}
              name="attach"
              size={iconSize.action}
            />
          )}
          {!compact && (
            <Text style={styles.attachButtonText}>
              Attach {comments.length === 0 ? "" : comments.length}
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.workspace}>
        <View style={styles.editorPane}>
          <CodeReviewEditor
            commentDraft={commentDraft}
            comments={comments}
            compact={compact}
            document={document}
            files={reviewFiles}
            loadError={loadError}
            loading={loading}
            mode={effectiveMode}
            onCommentDraftChange={updateCommentDraft}
            onCommentSelectionChange={(selection) => {
              selectionRef.current = selection;
            }}
            onCommentSubmit={addComment}
            onFileSelect={(path) => {
              const change = changes.find((candidate) => candidate.path === path);
              if (change !== undefined) {
                selectFile(change);
              }
            }}
            onLinePress={selectLine}
            onVoicePress={(draft, selection) => void pressVoice(draft, selection)}
            revealReference={selectedReference === null ? revealReference : null}
            selectedPath={effectiveSelectedPath}
            selectedReference={selectedReference}
            sidebarOpen={sidebarOpen}
            voiceError={voiceResource?.error ?? null}
            voicePermissionGranted={microphoneAccess.granted}
            voicePhase={voiceResource?.phase ?? "idle"}
            voiceRetryAvailable={voiceResource?.retryAvailable ?? false}
            workspaceRevision={workspaceRevision}
            wrapLines={wrapLines}
          />
          {comments.length > 0 && (
            <ScrollView
              contentContainerStyle={styles.commentStripContent}
              horizontal
              keyboardShouldPersistTaps="handled"
              style={styles.commentStrip}
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
                    onPress={() => {
                      setComments((current) =>
                        current.filter((candidate) => candidate.id !== comment.id),
                      );
                    }}
                  >
                    <Ionicons color={colors.textDim} name="close-circle" size={iconSize.inline} />
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

import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { useCodeReviewState } from "./codeReviewState";
import { styles } from "./CodeReviewWorkspace.styles";
import { ReviewCommentStrip } from "./ReviewCommentStrip";

import { changeScopeDisplay } from "../../../rendering/changeScopeDisplay";
import { changedFileDisplayPath } from "../../../rendering/changed-file-path";
import { CommentSheet } from "../comments/CommentSheet";
import type { CodeReviewComment } from "../comments/reviewComment";
import { CodeReviewEditor } from "../editor/CodeReviewEditor";
import type { CodeReviewInlineComment } from "../editor/editorBridge";
import { colors, iconSize } from "../../../theme";
import { OverflowMenu } from "../../../ui/OverflowMenu";
import { AppText as Text } from "../../../ui/Typography";

/**
 * Composes file selection, diff viewing, and review-comment submission. A line
 * tap opens the one native line composer; adding a comment closes it at once.
 */
export function CodeReviewWorkspace(props: CodeReviewWorkspaceProps) {
  const { cwd, scopeLabel } = props;
  const {
    attach,
    attachDisabled,
    attaching,
    changes,
    changeScope,
    close,
    closeComposer,
    comments,
    commitComment,
    compact,
    document,
    documentStatus,
    effectiveMode,
    effectiveSelectedPath,
    lineDrafts,
    loadError,
    loading,
    menuActions,
    revealReference,
    reviewFiles,
    scopeLoading,
    selectedReference,
    selectFile,
    selectLine,
    selectMenuAction,
    setComments,
    setSidebarPreference,
    setWorkspaceWidth,
    sidebarOpen,
    vcs,
    workspaceRevision,
    wrapLines,
  } = useCodeReviewState(props);
  const scopeDisplay = changeScopeDisplay(changeScope, vcs);

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
            {changeScope === "branch" && (
              <Ionicons color={colors.textMuted} name={scopeDisplay.icon} size={iconSize.inline} />
            )}
            <Text numberOfLines={1} style={styles.subtitle}>
              {scopeLabel ?? scopeDisplay.title} · {changes.length} files · {comments.length}{" "}
              comments
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
          {changeScope === "uncommitted" && (
            <Text
              accessibilityLabel={`Current VCS branch: ${vcs?.branch ?? "unavailable"}`}
              ellipsizeMode="middle"
              numberOfLines={1}
              style={styles.subtitle}
            >
              {vcs?.branch === undefined || vcs.branch === null
                ? "Branch unavailable"
                : `Branch: ${vcs.branch}`}
            </Text>
          )}
        </View>
        <OverflowMenu
          accessibilityLabel="Changes options"
          actions={menuActions}
          align="end"
          busy={scopeLoading}
          onSelect={selectMenuAction}
          placement="bottom"
          size="regular"
          tone="filled"
        />
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
            comments={savedInlineComments(comments)}
            compact={compact}
            document={document}
            files={reviewFiles}
            loadError={loadError}
            loading={loading}
            mode={effectiveMode}
            onFileSelect={(path) => {
              const change = changes.find((candidate) => candidate.path === path);
              if (change !== undefined) {
                selectFile(change);
              }
            }}
            onLinePress={selectLine}
            revealReference={selectedReference === null ? revealReference : null}
            selectedPath={effectiveSelectedPath}
            selectedReference={selectedReference}
            sidebarOpen={sidebarOpen}
            workspaceRevision={workspaceRevision}
            wrapLines={wrapLines}
          />
          <ReviewCommentStrip
            comments={comments}
            onDelete={(id) => {
              setComments((current) => current.filter((candidate) => candidate.id !== id));
            }}
          />
        </View>
      </View>
      {selectedReference === null ? null : (
        <CommentSheet
          accessory={null}
          drafts={lineDrafts}
          onDismiss={closeComposer}
          onSubmit={(body) => {
            commitComment(selectedReference, body);
          }}
          submitLabel="Add comment"
          target={selectedReference}
          voice={props.voiceRuntime}
        />
      )}
    </View>
  );
}

/** Local session/VCS comments are saved the moment they are added. */
function savedInlineComments(
  comments: readonly CodeReviewComment[],
): readonly CodeReviewInlineComment[] {
  return comments.map((comment) => ({
    body: comment.body,
    id: comment.id,
    line: comment.line,
    path: comment.path,
    side: comment.side,
    state: "saved" as const,
  }));
}

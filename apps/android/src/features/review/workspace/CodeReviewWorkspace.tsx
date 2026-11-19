import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import type { CodeReviewWorkspaceProps } from "./codeReviewContract";
import { useCodeReviewState } from "./codeReviewState";
import { styles } from "./CodeReviewWorkspace.styles";
import { ReviewFileNavigation } from "./ReviewFileNavigation";
import { ReviewCommentsSheet } from "./ReviewCommentsSheet";
import { useEvent } from "../../../react/useEvent";

import { changeScopeDisplay } from "../../../rendering/changeScopeDisplay";

import { LineCommentFrame } from "../comments/LineCommentFrame";
import type { CodeReviewComment } from "../comments/reviewComment";
import { CodeReviewEditor } from "../editor/CodeReviewEditor";
import type { CodeReviewInlineComment } from "../editor/editorBridge";
import { colors, iconSize } from "../../../theme";
import { OverflowMenu } from "../../../ui/OverflowMenu";
import { AppText as Text } from "../../../ui/Typography";

/**
 * Composes file selection, diff viewing, and review-comment submission. A line
 * tap opens the one line composer docked under the diff; adding a comment
 * closes it at once.
 */
export function CodeReviewWorkspace(props: CodeReviewWorkspaceProps): React.JSX.Element {
  const [notesOpen, setNotesOpen] = useState(false);
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
    editComment,
    editing,
    effectiveMode,
    effectiveSelectedPath,
    lineDrafts,
    loadError,
    loading,
    menuActions,
    retryLoad,
    revealReference,
    reviewFiles,
    scopeLoading,
    selectedReference,
    selectFile,
    selectLine,
    selectMenuAction,
    setComments,
    setFilesOpen,
    setWorkspaceWidth,
    sidebarOpen,
    vcs,
    workspaceRevision,
    wrapLines,
  } = useCodeReviewState(props);
  const scopeDisplay = changeScopeDisplay(changeScope, vcs);

  const openNotes = useEvent(() => {
    setNotesOpen(true);
  });
  const onEdit = useEvent((comment: CodeReviewComment) => {
    setNotesOpen(false);
    editComment(comment);
  });
  const onDelete = useEvent((id: string) => {
    setComments((current) => current.filter((comment) => comment.id !== id));
  });
  const index = changes.findIndex((file) => file.path === effectiveSelectedPath);
  const currentFile = reviewFiles[index];
  const previous = changes[index - 1];
  const next = index < 0 ? undefined : changes[index + 1];
  const goPrevious = useEvent(() => {
    if (previous !== undefined) {
      selectFile(previous);
    }
  });
  const goNext = useEvent(() => {
    if (next !== undefined) {
      selectFile(next);
    }
  });
  const toggleFiles = useEvent(() => {
    setFilesOpen(!sidebarOpen);
  });
  const sheetOpen = compact && sidebarOpen && Platform.OS !== "web";
  const options = [
    ...menuActions,
    ...(compact && changes.length > 1
      ? [
          {
            disabled: previous === undefined,
            id: "previous",
            label: "Previous file",
            section: "Navigate",
          },
          {
            disabled: next === undefined,
            id: "next",
            label: "Next file",
            section: "Navigate",
          },
        ]
      : []),
    {
      description: [props.scopeLabel ?? scopeDisplay.title, vcs?.branch, documentStatus]
        .filter(Boolean)
        .join(" · "),
      disabled: true,
      id: "file-info",
      label: currentFile?.treePath ?? "Changes",
      section: "File",
    },
  ];
  const onAction = useEvent((id: string) => {
    if (id === "previous") {
      goPrevious();
    } else if (id === "next") {
      goNext();
    } else {
      selectMenuAction(id);
    }
  });
  return (
    <View
      onLayout={({ nativeEvent }) => {
        setWorkspaceWidth(Math.floor(nativeEvent.layout.width));
      }}
      style={styles.root}
      testID="code-review-workspace"
    >
      <LineCommentFrame
        composer={
          selectedReference === null
            ? null
            : {
                drafts: lineDrafts,
                onClose: closeComposer,
                onSubmit: commitComment,
                submitLabel: editing ? "Save comment" : "Add comment",
                target: selectedReference,
                voice: props.voiceRuntime,
              }
        }
      >
        <View>
          <View
            accessibilityElementsHidden={sheetOpen}
            importantForAccessibility={sheetOpen ? "no-hide-descendants" : "auto"}
            style={styles.chrome}
          >
            <Pressable
              accessibilityLabel="Close code review"
              accessibilityRole="button"
              onPress={close}
              style={styles.iconButton}
            >
              <Ionicons color={colors.text} name="close" size={iconSize.action} />
            </Pressable>
            <ReviewFileNavigation
              compact={compact}
              count={changes.length}
              file={currentFile}
              index={index}
              onNext={goNext}
              onPrevious={goPrevious}
              onToggle={toggleFiles}
              open={sidebarOpen}
            />
            <View style={styles.right}>
              <Pressable
                accessibilityLabel="Review comments"
                accessibilityRole="button"
                onPress={openNotes}
                style={styles.review}
              >
                <Ionicons color={colors.text} name="chatbubble-outline" size={iconSize.inline} />
                <Text style={styles.location}>{comments.length}</Text>
              </Pressable>
              <OverflowMenu
                accessibilityLabel="Changes options"
                actions={options}
                align="end"
                busy={scopeLoading}
                onSelect={onAction}
                placement="bottom"
                size="regular"
              />
            </View>
          </View>
          {sheetOpen && (
            <Pressable
              accessibilityLabel="Dismiss file list"
              accessibilityRole="button"
              onPress={toggleFiles}
              style={styles.sheetBackdrop}
            />
          )}
        </View>
        <CodeReviewEditor
          comments={savedInlineComments(comments)}
          compact={compact}
          document={document}
          files={reviewFiles}
          loadError={loadError}
          loading={loading}
          mode={effectiveMode}
          onCommentPress={(id) => {
            const note = comments.find((comment) => comment.id === id);
            if (note !== undefined) {
              onEdit(note);
            }
          }}
          onFileSelect={(path) => {
            const change = changes.find((candidate) => candidate.path === path);
            if (change !== undefined) {
              selectFile(change);
            }
          }}
          onFilesOpenChange={setFilesOpen}
          onLinePress={selectLine}
          onRetryLoad={retryLoad}
          revealReference={
            editing ? selectedReference : selectedReference === null ? revealReference : null
          }
          selectedPath={effectiveSelectedPath}
          selectedReference={selectedReference}
          sidebarOpen={sidebarOpen}
          workspaceRevision={workspaceRevision}
          wrapLines={wrapLines}
        />
      </LineCommentFrame>
      {notesOpen && (
        <ReviewCommentsSheet
          comments={comments}
          disabled={attachDisabled || attaching}
          onAttach={attach}
          onDelete={onDelete}
          onEdit={onEdit}
          onOpenChange={setNotesOpen}
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
    editable: true,
    id: comment.id,
    line: comment.line,
    path: comment.path,
    side: comment.side,
    state: "saved" as const,
  }));
}

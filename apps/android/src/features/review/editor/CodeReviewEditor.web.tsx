import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import {
  colors,
  spacing,
  typeScale,
  typeWeight,
  iconSize,
  radii,
  controlSize,
  layoutSize,
} from "../../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../../ui/Typography";
import type { CodeReviewDocument, CodeReviewFileItem, CodeReviewViewMode } from "./editorBridge";
import {
  codeReviewDocumentEmptyState,
  EMPTY_CHANGES_STATE,
  EMPTY_CHANGES_TREE_STATE,
  type CodeReviewEmptyState,
} from "./editorEmptyState";
import type { CodeReviewComment, CodeReviewLineReference } from "../comments/reviewComment";

export type { CodeReviewDocument, CodeReviewFileItem, CodeReviewViewMode } from "./editorBridge";

type DraftSelection = { end: number; start: number };
type VoicePhase = "idle" | "starting" | "recording" | "finishing";

export function CodeReviewEditor({
  commentDraft,
  comments,
  compact,
  document,
  files,
  loadError,
  loading,
  mode,
  onCommentDraftChange,
  onCommentSelectionChange,
  onCommentSubmit,
  onFileSelect,
  onLinePress,
  onVoicePress,
  selectedPath,
  selectedReference,
  sidebarOpen,
  voiceError,
  voicePermissionGranted,
  voicePhase,
  voiceRetryAvailable,
  wrapLines,
}: {
  commentDraft: string;
  comments: readonly CodeReviewComment[];
  compact: boolean;
  document: CodeReviewDocument | null;
  files: readonly CodeReviewFileItem[];
  loadError: string | null;
  loading: boolean;
  mode: CodeReviewViewMode;
  onCommentDraftChange: (value: string) => void;
  onCommentSelectionChange: (selection: DraftSelection) => void;
  onCommentSubmit: (reference: CodeReviewLineReference, draft: string) => void;
  onFileSelect: (path: string) => void;
  onLinePress: (reference: CodeReviewLineReference) => void;
  onVoicePress: (draft: string, selection: DraftSelection) => void;
  revealReference: CodeReviewLineReference | null;
  selectedPath: string | null;
  selectedReference: CodeReviewLineReference | null;
  sidebarOpen: boolean;
  voiceError: string | null;
  voicePermissionGranted: boolean;
  voicePhase: VoicePhase;
  voiceRetryAvailable: boolean;
  workspaceRevision: string;
  wrapLines: boolean;
}) {
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;
  const documentEmptyState =
    document === null ? null : codeReviewDocumentEmptyState(document, mode);
  return (
    <View style={[styles.workspace, compact && sidebarOpen && styles.compactSidebar]}>
      {sidebarOpen && (
        <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
          <ScrollView
            contentContainerStyle={styles.sidebarContent}
            keyboardShouldPersistTaps="handled"
            style={styles.sidebarScroll}
          >
            {files.length === 0 && <ReviewEmptyState state={EMPTY_CHANGES_TREE_STATE} />}
            {files.map((file) => (
              <Pressable
                key={file.path}
                onPress={() => {
                  onFileSelect(file.path);
                }}
                style={[styles.fileRow, file.path === selectedPath && styles.fileRowSelected]}
              >
                <Ionicons
                  color={colors.textMuted}
                  name={
                    file.status === "added"
                      ? "add-circle-outline"
                      : file.status === "deleted"
                        ? "remove-circle-outline"
                        : "document-text-outline"
                  }
                  size={iconSize.inline}
                />
                <Text ellipsizeMode="middle" numberOfLines={1} style={styles.fileName}>
                  {file.treePath}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      {(!compact || !sidebarOpen) && (
        <View style={styles.preview}>
          {document === null ? (
            <View style={styles.empty}>
              {loading && <ActivityIndicator color={colors.accent} />}
              {loadError !== null || loading ? (
                <Text style={styles.muted}>{loadError ?? "Loading file…"}</Text>
              ) : (
                <ReviewEmptyState
                  state={
                    files.length === 0
                      ? EMPTY_CHANGES_STATE
                      : { message: "Choose a changed file from the tree.", title: "Select a file" }
                  }
                />
              )}
            </View>
          ) : documentEmptyState !== null ? (
            <ReviewEmptyState state={documentEmptyState} />
          ) : document.displayState === "image" ? (
            <Image
              accessibilityLabel="Changed image"
              resizeMode="contain"
              source={{ uri: document.imageDataUrl }}
              style={styles.imagePreview}
            />
          ) : (
            <ScrollView contentContainerStyle={styles.codeContent} horizontal={!wrapLines}>
              <View style={styles.lines}>
                {document.source.split("\n").map((line, index) => {
                  const lineNumber = index + 1;
                  const reference: CodeReviewLineReference = {
                    context: line,
                    coordinate: "file",
                    line: lineNumber,
                    path: document.path,
                    side: "new",
                  };
                  const selected =
                    selectedReference !== null && sameReference(reference, selectedReference);
                  return (
                    <View key={lineReferenceKey(reference)}>
                      <Pressable
                        onPress={() => {
                          onLinePress(reference);
                        }}
                        style={[styles.line, selected && styles.lineSelected]}
                      >
                        <Text style={styles.lineNumber}>{lineNumber}</Text>
                        <Text selectable style={[styles.code, wrapLines && styles.codeWrapped]}>
                          {line === "" ? " " : line}
                        </Text>
                      </Pressable>
                      {selected && (
                        <View style={styles.composer}>
                          <TextInput
                            autoFocus
                            multiline
                            onChangeText={onCommentDraftChange}
                            onSelectionChange={({ nativeEvent }) => {
                              onCommentSelectionChange(nativeEvent.selection);
                            }}
                            placeholder="Comment on this line…"
                            placeholderTextColor={colors.textMuted}
                            style={styles.input}
                            value={commentDraft}
                            voiceInput={false}
                          />
                          <Pressable
                            onPress={() => {
                              onVoicePress(commentDraft, {
                                end: commentDraft.length,
                                start: commentDraft.length,
                              });
                            }}
                            style={styles.iconButton}
                          >
                            <Ionicons
                              color={
                                voicePermissionGranted ||
                                voiceRetryAvailable ||
                                voicePhase !== "idle"
                                  ? colors.text
                                  : colors.textDim
                              }
                              name={
                                voiceRetryAvailable
                                  ? "refresh"
                                  : voicePhase === "idle"
                                    ? "mic-outline"
                                    : "stop"
                              }
                              size={iconSize.action}
                            />
                          </Pressable>
                          <Pressable
                            disabled={commentDraft.trim() === ""}
                            onPress={() => {
                              onCommentSubmit(reference, commentDraft);
                            }}
                            style={styles.iconButton}
                          >
                            <Ionicons color={colors.text} name="arrow-up" size={iconSize.action} />
                          </Pressable>
                          {voiceError !== null && <Text style={styles.error}>{voiceError}</Text>}
                        </View>
                      )}
                    </View>
                  );
                })}
                {mode !== "source" && document.patches.length > 0 && (
                  <Text style={styles.muted}>
                    Rich diff rendering is available in the Android build.
                  </Text>
                )}
                {comments.map((comment) => (
                  <Text key={comment.id} style={styles.comment}>
                    {comment.path}:{comment.line} · {comment.body}
                  </Text>
                ))}
              </View>
            </ScrollView>
          )}
          {selectedFile !== null && (
            <Text numberOfLines={1} style={styles.path}>
              {selectedFile.treePath}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function ReviewEmptyState({ state }: { state: CodeReviewEmptyState }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyMark}>
        <Text style={styles.emptyMarkText}>—</Text>
      </View>
      <Text style={styles.emptyTitle}>{state.title}</Text>
      <Text style={styles.emptyMessage}>{state.message}</Text>
    </View>
  );
}

function sameReference(left: CodeReviewLineReference, right: CodeReviewLineReference): boolean {
  return left.path === right.path && left.line === right.line && left.side === right.side;
}

function lineReferenceKey(reference: CodeReviewLineReference): string {
  return `${reference.path}:${reference.side}:${String(reference.line)}`;
}

const styles = StyleSheet.create({
  code: {
    color: colors.text,
    minWidth: 360,
    paddingHorizontal: spacing.sm,
    ...typeScale.code,
    fontFamily: "monospace",
  },
  codeContent: {
    flexGrow: 1,
    minWidth: "100%",
  },
  codeWrapped: {
    flexShrink: 1,
    minWidth: 0,
  },
  comment: {
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.optical,
  },
  compactSidebar: { flexDirection: "column" },
  composer: {
    alignItems: "flex-end",
    backgroundColor: colors.surfaceContainer,
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
  },
  emptyMark: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.outline,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  emptyMarkText: {
    color: colors.textDim,
    ...typeScale.heading,
    fontWeight: typeWeight.semibold,
  },
  emptyMessage: {
    color: colors.textMuted,
    maxWidth: 340,
    ...typeScale.body,
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.compact,
    justifyContent: "center",
    minHeight: 160,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
    textAlign: "center",
  },
  error: {
    bottom: -20,
    color: colors.red,
    left: spacing.sm,
    position: "absolute",
    ...typeScale.label,
  },
  fileName: {
    color: colors.text,
    flex: 1,
    ...typeScale.body,
  },
  fileRow: {
    alignItems: "center",
    borderRadius: radii.small,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  fileRowSelected: { backgroundColor: colors.surfaceContainerHighest },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.medium,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  imagePreview: {
    flex: 1,
    margin: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.medium,
    color: colors.text,
    flex: 1,
    maxHeight: 120,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  line: {
    alignItems: "flex-start",
    flexDirection: "row",
    minHeight: layoutSize.metadataRow,
  },
  lineNumber: {
    color: colors.textDim,
    paddingRight: spacing.sm,
    textAlign: "right",
    width: 48,
    ...typeScale.code,
    fontFamily: "monospace",
  },
  lines: {
    flex: 1,
    minWidth: "100%",
    paddingVertical: spacing.xs,
  },
  lineSelected: { backgroundColor: "rgba(120,169,255,0.12)" },
  muted: {
    color: colors.textMuted,
    padding: spacing.sm,
  },
  path: {
    color: colors.textDim,
    maxWidth: "60%",
    position: "absolute",
    right: 8,
    top: 6,
    ...typeScale.label,
  },
  preview: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  sidebar: {
    borderRightColor: colors.outline,
    borderRightWidth: StyleSheet.hairlineWidth,
    minWidth: 220,
    width: 300,
  },
  sidebarCompact: {
    borderRightWidth: 0,
    flex: 1,
    width: "100%",
  },
  sidebarContent: {
    flexGrow: 1,
    gap: spacing.optical,
    padding: spacing.sm,
  },
  sidebarScroll: { flex: 1 },
  workspace: {
    backgroundColor: colors.background,
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0,
  },
});

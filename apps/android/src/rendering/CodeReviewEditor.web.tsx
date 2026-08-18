import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, spacing } from "../theme";
import { AppText as Text, AppTextInput as TextInput } from "../ui/Typography";
import type {
  CodeReviewDocument,
  CodeReviewFileItem,
  CodeReviewViewMode,
} from "./code-review-bridge";
import type { CodeReviewComment, CodeReviewLineReference } from "./code-review";

export type { CodeReviewDocument, CodeReviewFileItem, CodeReviewViewMode } from "./code-review-bridge";

type DraftSelection = { start: number; end: number };
type VoicePhase = "idle" | "starting" | "recording" | "finishing";

export function CodeReviewEditor({
  document,
  loading,
  loadError,
  files,
  selectedPath,
  sidebarOpen,
  compact,
  wrapLines,
  mode,
  comments,
  selectedReference,
  commentDraft,
  voicePhase,
  voiceRetryAvailable,
  voiceError,
  onLinePress,
  onCommentDraftChange,
  onCommentSelectionChange,
  onCommentSubmit,
  onVoicePress,
  onFileSelect,
}: {
  document: CodeReviewDocument | null;
  loading: boolean;
  loadError: string | null;
  files: readonly CodeReviewFileItem[];
  workspaceRevision: string;
  selectedPath: string | null;
  sidebarOpen: boolean;
  compact: boolean;
  wrapLines: boolean;
  mode: CodeReviewViewMode;
  comments: readonly CodeReviewComment[];
  selectedReference: CodeReviewLineReference | null;
  revealReference: CodeReviewLineReference | null;
  commentDraft: string;
  voicePhase: VoicePhase;
  voiceRetryAvailable: boolean;
  voiceError: string | null;
  onLinePress(reference: CodeReviewLineReference): void;
  onCommentDraftChange(value: string): void;
  onCommentSelectionChange(selection: DraftSelection): void;
  onCommentSubmit(reference: CodeReviewLineReference, draft: string): void;
  onVoicePress(draft: string, selection: DraftSelection): void;
  onFileSelect(path: string): void;
}) {
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;
  return (
    <View style={[styles.workspace, compact && sidebarOpen && styles.compactSidebar]}>
      {sidebarOpen && (
        <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
          <ScrollView contentContainerStyle={styles.sidebarContent} keyboardShouldPersistTaps="handled">
            {files.map((file) => (
              <Pressable key={file.path} onPress={() => onFileSelect(file.path)} style={[styles.fileRow, file.path === selectedPath && styles.fileRowSelected]}>
                <Ionicons name={file.status === "added" ? "add-circle-outline" : file.status === "deleted" ? "remove-circle-outline" : "document-text-outline"} size={16} color={colors.textMuted} />
                <Text numberOfLines={1} ellipsizeMode="middle" style={styles.fileName}>{file.treePath}</Text>
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
              <Text style={styles.muted}>{loadError ?? (loading ? "Loading file…" : "Select a changed file")}</Text>
            </View>
          ) : (
            <ScrollView horizontal={!wrapLines} contentContainerStyle={styles.codeContent}>
              <View style={styles.lines}>
                {document.source.split("\n").map((line, index) => {
                  const lineNumber = index + 1;
                  const reference: CodeReviewLineReference = { path: document.path, line: lineNumber, side: "new", coordinate: "file", context: line };
                  const selected = selectedReference !== null && sameReference(reference, selectedReference);
                  return (
                    <View key={lineNumber}>
                      <Pressable onPress={() => onLinePress(reference)} style={[styles.line, selected && styles.lineSelected]}>
                        <Text style={styles.lineNumber}>{lineNumber}</Text>
                        <Text selectable style={[styles.code, wrapLines && styles.codeWrapped]}>{line || " "}</Text>
                      </Pressable>
                      {selected && (
                        <View style={styles.composer}>
                          <TextInput
                            voiceInput={false}
                            autoFocus
                            multiline
                            value={commentDraft}
                            placeholder="Comment on this line…"
                            placeholderTextColor={colors.textMuted}
                            onChangeText={onCommentDraftChange}
                            onSelectionChange={({ nativeEvent }) => onCommentSelectionChange(nativeEvent.selection)}
                            style={styles.input}
                          />
                          <Pressable onPress={() => onVoicePress(commentDraft, { start: commentDraft.length, end: commentDraft.length })} style={styles.iconButton}>
                            <Ionicons name={voiceRetryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop"} size={18} color={colors.text} />
                          </Pressable>
                          <Pressable disabled={commentDraft.trim() === ""} onPress={() => onCommentSubmit(reference, commentDraft)} style={styles.iconButton}>
                            <Ionicons name="arrow-up" size={18} color={colors.text} />
                          </Pressable>
                          {voiceError !== null && <Text style={styles.error}>{voiceError}</Text>}
                        </View>
                      )}
                    </View>
                  );
                })}
                {mode !== "source" && document.patches.length > 0 && <Text style={styles.muted}>Rich diff rendering is available in the Android build.</Text>}
                {comments.map((comment) => <Text key={comment.id} style={styles.comment}>{comment.path}:{comment.line} · {comment.body}</Text>)}
              </View>
            </ScrollView>
          )}
          {selectedFile !== null && <Text numberOfLines={1} style={styles.path}>{selectedFile.treePath}</Text>}
        </View>
      )}
    </View>
  );
}

function sameReference(left: CodeReviewLineReference, right: CodeReviewLineReference): boolean {
  return left.path === right.path && left.line === right.line && left.side === right.side;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row", backgroundColor: colors.background },
  compactSidebar: { flexDirection: "column" },
  sidebar: { width: 300, minWidth: 220, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.outline },
  sidebarCompact: { width: "100%", flex: 1, borderRightWidth: 0 },
  sidebarContent: { padding: spacing.sm, gap: 2 },
  fileRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: 10 },
  fileRowSelected: { backgroundColor: colors.surfaceContainerHighest },
  fileName: { flex: 1, color: colors.text, fontSize: 13 },
  preview: { flex: 1, minWidth: 0, minHeight: 0 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  muted: { color: colors.textMuted, padding: spacing.sm },
  codeContent: { flexGrow: 1, minWidth: "100%" },
  lines: { flex: 1, minWidth: "100%", paddingVertical: spacing.xs },
  line: { minHeight: 24, flexDirection: "row", alignItems: "flex-start" },
  lineSelected: { backgroundColor: "rgba(120,169,255,0.12)" },
  lineNumber: { width: 48, paddingRight: spacing.sm, color: colors.textDim, textAlign: "right", fontFamily: "monospace", fontSize: 12, lineHeight: 20 },
  code: { minWidth: 360, paddingHorizontal: spacing.sm, color: colors.text, fontFamily: "monospace", fontSize: 13, lineHeight: 20 },
  codeWrapped: { minWidth: 0, flexShrink: 1 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, padding: spacing.sm, backgroundColor: colors.surfaceContainer },
  input: { flex: 1, minHeight: 40, maxHeight: 120, color: colors.text, backgroundColor: colors.surfaceContainerHighest, borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.surfaceContainerHighest },
  error: { position: "absolute", left: spacing.sm, bottom: -20, color: colors.red, fontSize: 11 },
  comment: { color: colors.textMuted, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  path: { position: "absolute", top: 6, right: 8, maxWidth: "60%", color: colors.textDim, fontSize: 11 },
});

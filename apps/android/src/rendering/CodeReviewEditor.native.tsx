import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { colors, spacing } from "../theme";
import { AppText as Text } from "../ui/Typography";
import type {
  CodeReviewClientEvent,
  CodeReviewComposerState,
  CodeReviewDocument,
  CodeReviewFileItem,
  CodeReviewHostCommand,
  CodeReviewViewMode,
} from "./code-review-bridge";
import { CODE_REVIEW_BRIDGE_VERSION } from "./code-review-bridge";
import type { CodeReviewComment, CodeReviewLineReference } from "./code-review";

const EDITOR_URI = "file:///android_asset/code-review-editor.html";

export type { CodeReviewDocument, CodeReviewFileItem, CodeReviewViewMode } from "./code-review-bridge";

type DraftSelection = { start: number; end: number };
type VoicePhase = "idle" | "starting" | "recording" | "finishing";
type WithoutBridgeEnvelope<T> = T extends unknown ? Omit<T, "version" | "sequence"> : never;
type CodeReviewHostMessage = WithoutBridgeEnvelope<CodeReviewHostCommand>;

export function CodeReviewEditor({
  document,
  loading,
  loadError,
  files,
  workspaceRevision,
  selectedPath,
  sidebarOpen,
  compact,
  wrapLines,
  mode,
  comments,
  selectedReference,
  revealReference,
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
  const webView = useRef<WebView>(null);
  const requestId = useRef(0);
  const sequence = useRef(0);
  const revealedReference = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<{ revision: string | null; message: string } | null>(null);

  const send = (message: CodeReviewHostMessage) => {
    sequence.current += 1;
    webView.current?.postMessage(JSON.stringify({
      version: CODE_REVIEW_BRIDGE_VERSION,
      sequence: sequence.current,
      ...message,
    } satisfies CodeReviewHostCommand));
  };

  useEffect(() => {
    if (!ready) return;
    send({ command: "settings", payload: { mode, wrapLines } });
  }, [ready, mode, wrapLines]);

  useEffect(() => {
    if (!ready) return;
    const nextRequestId = requestId.current + 1;
    requestId.current = nextRequestId;
    send({ command: "document", payload: { requestId: nextRequestId, document } });
  }, [ready, document]);

  useEffect(() => {
    if (!ready) return;
    send({ command: "comments", payload: comments });
  }, [ready, comments]);

  useEffect(() => {
    if (!ready) return;
    send({ command: "workspace", payload: { files, revision: workspaceRevision, selectedPath, sidebarOpen, compact } });
  }, [ready, files, workspaceRevision, selectedPath, sidebarOpen, compact]);

  useEffect(() => {
    if (!ready) return;
    const payload: CodeReviewComposerState | null = selectedReference === null ? null : {
      reference: selectedReference,
      draft: commentDraft,
      voicePhase,
      voiceRetryAvailable,
      voiceError,
    };
    send({ command: "composer", payload });
  }, [ready, selectedReference, commentDraft, voicePhase, voiceRetryAvailable, voiceError]);

  useEffect(() => {
    if (!ready || revealReference === null) return;
    const key = `${revealReference.path}:${revealReference.line}:${revealReference.column ?? ""}`;
    if (revealedReference.current === key) return;
    revealedReference.current = key;
    send({ command: "reveal", payload: revealReference });
  }, [ready, revealReference]);

  const receive = ({ nativeEvent }: WebViewMessageEvent) => {
    const message = parseClientEvent(nativeEvent.data);
    if (message === null) return;
    if (message.type === "ready") {
      setReady(true);
      return;
    }
    if ("requestId" in message && message.requestId !== requestId.current) return;
    if (message.type === "rendered") {
      if (__DEV__) console.log(`[CodeWide perf] code_review_rendered_ms=${message.renderMs.toFixed(1)} mode=${mode}`);
    } else if (message.type === "fileSelect") {
      onFileSelect(message.path);
    } else if (message.type === "lineTap") {
      onLinePress(message.reference);
    } else if (message.type === "draftChanged") {
      onCommentDraftChange(message.draft);
      onCommentSelectionChange({ start: message.selectionStart, end: message.selectionEnd });
    } else if (message.type === "commentSubmit") {
      onCommentSubmit(message.reference, message.draft);
    } else if (message.type === "voiceAction") {
      onVoicePress(message.draft, { start: message.selectionStart, end: message.selectionEnd });
    } else if (message.type === "error") {
      setError({ revision: document?.revision ?? null, message: message.message });
    }
  };

  const currentRevision = document?.revision ?? null;
  const currentError = error?.revision === currentRevision ? error.message : null;
  const visibleError = currentError ?? loadError;
  const showInitialLoading = document === null && loading && visibleError === null;
  return (
    <View style={styles.root}>
      <WebView
        ref={webView}
        testID="code-review-editor"
        source={{ uri: EDITOR_URI }}
        style={styles.webView}
        originWhitelist={["file://*"]}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        overScrollMode="never"
        onLoadStart={() => {
          revealedReference.current = null;
          setReady(false);
        }}
        onMessage={receive}
        onError={({ nativeEvent }) => {
          setError({ revision: document?.revision ?? null, message: nativeEvent.description || "Code editor failed to load" });
        }}
        onShouldStartLoadWithRequest={({ url }) => url.startsWith("file:///android_asset/")}
      />
      {showInitialLoading && <View pointerEvents="none" style={styles.loading}><ActivityIndicator color={colors.accent} /></View>}
      {visibleError !== null && (
        <View style={styles.error}>
          <Text selectable style={styles.errorTitle}>Code preview failed</Text>
          <Text selectable style={styles.errorMessage}>{visibleError}</Text>
          <Pressable accessibilityRole="button" onPress={() => webView.current?.reload()} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function parseClientEvent(value: string): CodeReviewClientEvent | null {
  try {
    const parsed = JSON.parse(value) as Partial<CodeReviewClientEvent>;
    return parsed !== null && typeof parsed === "object" && parsed.version === CODE_REVIEW_BRIDGE_VERSION && typeof parsed.type === "string"
      ? parsed as CodeReviewClientEvent
      : null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  webView: { flex: 1, backgroundColor: colors.background },
  loading: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  error: { position: "absolute", inset: spacing.md, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: 18, backgroundColor: colors.surfaceContainer },
  errorTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  errorMessage: { maxWidth: 520, color: colors.textMuted, textAlign: "center" },
  retryButton: { minWidth: 96, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 20, backgroundColor: colors.accent },
  retryText: { color: colors.onPrimary, fontWeight: "700" },
});

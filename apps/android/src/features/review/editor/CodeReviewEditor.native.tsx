import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { appLogger } from "../../../observability/logger";
import { unknownRecord } from "../../../data/unknownRecord";
import { colors, spacing, typeScale, typeWeight, radii, controlSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { CodeReviewClientEvent, CodeReviewHostCommand } from "./editorBridge";
import { CODE_REVIEW_BRIDGE_VERSION } from "./editorBridge";
import type { CodeReviewLineReference } from "../comments/reviewComment";
import type { CodeReviewEditorProps } from "./codeReviewEditorProps";

const EDITOR_URI = "file:///android_asset/code-review-editor.html";

export type { CodeReviewDocument, CodeReviewFileItem, CodeReviewViewMode } from "./editorBridge";

type WithoutBridgeEnvelope<T> = T extends unknown ? Omit<T, "version" | "sequence"> : never;
type CodeReviewHostMessage = WithoutBridgeEnvelope<CodeReviewHostCommand>;

/**
 * The Pierre review editor in its WebView. It displays the document, the file
 * tree and inline comments, and reports line taps; the selected line is the
 * native line composer's anchor. It hosts no composer of its own.
 */
// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
export function CodeReviewEditor({
  comments,
  compact,
  document,
  files,
  loadError,
  loading,
  mode,
  onFileSelect,
  onLinePress,
  revealReference,
  selectedPath,
  selectedReference,
  sidebarOpen,
  workspaceRevision,
  wrapLines,
}: CodeReviewEditorProps) {
  const webView = useRef<WebView>(null);
  const requestId = useRef(0);
  const sequence = useRef(0);
  const revealedReference = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<{ message: string; revision: string | null } | null>(null);

  const send = (message: CodeReviewHostMessage) => {
    sequence.current += 1;
    webView.current?.postMessage(
      JSON.stringify({
        sequence: sequence.current,
        version: CODE_REVIEW_BRIDGE_VERSION,
        ...message,
      } satisfies CodeReviewHostCommand),
    );
  };

  useEffect(() => {
    if (!ready) {
      return;
    }
    send({ command: "settings", payload: { mode, wrapLines } });
  }, [ready, mode, wrapLines]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const nextRequestId = requestId.current + 1;
    requestId.current = nextRequestId;
    send({ command: "document", payload: { document, requestId: nextRequestId } });
  }, [ready, document]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    send({ command: "comments", payload: comments });
  }, [ready, comments]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    send({
      command: "workspace",
      payload: { compact, files, revision: workspaceRevision, selectedPath, sidebarOpen },
    });
  }, [ready, files, workspaceRevision, selectedPath, sidebarOpen, compact]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    send({ command: "selection", payload: selectedReference });
  }, [ready, selectedReference]);

  useEffect(() => {
    if (!ready || revealReference === null) {
      return;
    }
    const key = `${revealReference.path}:${String(revealReference.line)}:${String(revealReference.column ?? "")}`;
    if (revealedReference.current === key) {
      return;
    }
    revealedReference.current = key;
    send({ command: "reveal", payload: revealReference });
  }, [ready, revealReference]);

  // WHY: This dispatcher applies one validated WebView event in protocol order; splitting its
  // branches would risk accepting stale request ids or reordering editor state updates.
  // oxlint-disable-next-line eslint/complexity
  const receive = ({ nativeEvent }: WebViewMessageEvent) => {
    const message = parseClientEvent(nativeEvent.data);
    if (message === null) {
      return;
    }
    if (message.type === "ready") {
      setReady(true);
      return;
    }
    if ("requestId" in message && message.requestId !== requestId.current) {
      return;
    }
    if (message.type === "rendered") {
      if (__DEV__) {
        appLogger.info({
          event: "code_review.rendered",
          fields: { durationMs: message.renderMs, mode },
        });
      }
    } else if (message.type === "fileSelect") {
      onFileSelect(message.path);
    } else if (message.type === "lineTap") {
      onLinePress(message.reference);
    } else if (message.type === "error") {
      setError({ message: message.message, revision: document?.revision ?? null });
    }
  };

  const currentRevision = document?.revision ?? null;
  const currentError = error?.revision === currentRevision ? error.message : null;
  const visibleError = currentError ?? loadError;
  return (
    <View style={styles.root}>
      <WebView
        allowFileAccess
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled={false}
        javaScriptEnabled
        mixedContentMode="never"
        onError={({ nativeEvent }) => {
          setError({
            message:
              nativeEvent.description === ""
                ? "Code editor failed to load"
                : nativeEvent.description,
            revision: document?.revision ?? null,
          });
        }}
        onLoadStart={() => {
          revealedReference.current = null;
          setReady(false);
        }}
        onMessage={receive}
        onShouldStartLoadWithRequest={({ url }) => url.startsWith("file:///android_asset/")}
        originWhitelist={["file://*"]}
        overScrollMode="never"
        ref={webView}
        setSupportMultipleWindows={false}
        source={{ uri: EDITOR_URI }}
        style={styles.webView}
        testID="code-review-editor"
      />
      {visibleError === null &&
        selectedPath !== null &&
        (!ready || (loading && document === null && !sidebarOpen)) && (
          <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Loading file…</Text>
          </View>
        )}
      {visibleError !== null && (
        <View style={styles.error}>
          <Text selectable style={styles.errorTitle}>
            Code preview failed
          </Text>
          <Text selectable style={styles.errorMessage}>
            {visibleError}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => webView.current?.reload()}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// WHY: The WebView event adapter validates one discriminated message atomically before exposing
// it as CodeReviewClientEvent; partial per-event decoders could accept inconsistent envelopes.
// oxlint-disable-next-line eslint/complexity
function parseClientEvent(value: string): CodeReviewClientEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const event = unknownRecord(parsed);
  if (event === null || event.version !== CODE_REVIEW_BRIDGE_VERSION) {
    return null;
  }
  if (event.type === "ready") {
    return { type: "ready", version: CODE_REVIEW_BRIDGE_VERSION };
  }
  if (typeof event.requestId !== "number") {
    return null;
  }
  const requestId = event.requestId;
  if (event.type === "rendered" && typeof event.renderMs === "number") {
    return {
      renderMs: event.renderMs,
      requestId,
      type: "rendered",
      version: CODE_REVIEW_BRIDGE_VERSION,
    };
  }
  if (event.type === "fileSelect" && typeof event.path === "string") {
    return { path: event.path, requestId, type: "fileSelect", version: CODE_REVIEW_BRIDGE_VERSION };
  }
  const reference = parseLineReference(event.reference);
  if (event.type === "lineTap" && reference !== null) {
    return { reference, requestId, type: "lineTap", version: CODE_REVIEW_BRIDGE_VERSION };
  }
  if (
    (event.type === "diffUnavailable" || event.type === "error") &&
    typeof event.message === "string"
  ) {
    return {
      message: event.message,
      requestId,
      type: event.type,
      version: CODE_REVIEW_BRIDGE_VERSION,
    };
  }
  return null;
}

// WHY: A line reference crosses the untrusted WebView boundary as one coordinate; every optional
// field must be checked together before the reference can target a native editor action.
// oxlint-disable-next-line eslint/complexity
function parseLineReference(value: unknown): CodeReviewLineReference | null {
  const reference = unknownRecord(value);
  if (
    reference === null ||
    typeof reference.line !== "number" ||
    typeof reference.path !== "string" ||
    !(reference.side === "new" || reference.side === "old") ||
    !(
      reference.coordinate === undefined ||
      reference.coordinate === "file" ||
      reference.coordinate === "diff"
    ) ||
    !(reference.column === undefined || typeof reference.column === "number") ||
    !(reference.context === undefined || typeof reference.context === "string")
  ) {
    return null;
  }
  return {
    line: reference.line,
    path: reference.path,
    side: reference.side,
    ...(reference.column === undefined ? {} : { column: reference.column }),
    ...(reference.context === undefined ? {} : { context: reference.context }),
    ...(reference.coordinate === undefined ? {} : { coordinate: reference.coordinate }),
  };
}

const styles = StyleSheet.create({
  error: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.selected,
    gap: spacing.sm,
    inset: spacing.md,
    justifyContent: "center",
    padding: spacing.lg,
    position: "absolute",
  },
  errorMessage: {
    color: colors.textMuted,
    maxWidth: 520,
    textAlign: "center",
  },
  errorTitle: {
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  loading: {
    alignItems: "center",
    backgroundColor: colors.background,
    gap: spacing.sm,
    inset: 0,
    justifyContent: "center",
    position: "absolute",
  },
  loadingText: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
    minWidth: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  retryText: {
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  webView: {
    backgroundColor: colors.background,
    flex: 1,
  },
});

import { isSafeLink, projectCompleteMarkdown } from "@codewide/rendering-core";
import { Ionicons } from "@expo/vector-icons";
import { Toast, useToast } from "heroui-native/toast";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { colors, spacing } from "../theme";
import { readPrivateAssetText, type GetTransferAccess, type PrivateAssetSource } from "../data/private-transfer";
import { documentReadingWidth, type DocumentLayoutMode } from "../data/user-preferences";
import { openDownloadedFile, pickDownloadDirectory, startDownload, startPreviewDownload, type RunningTransfer, type SelectedDirectory } from "../native/file-transfer";
import { useAppFullscreenOverlay, type AppFullscreenOverlayController } from "../ui/AppFullscreenOverlay";
import { ActionMenu, type ActionMenuItem } from "../ui/ActionMenu";
import { AppSheet, AppSheetScrollView } from "../ui/AppSheet";
import { useAppDialog } from "../ui/AppDialog";
import { AppText as Text } from "../ui/Typography";
import {
  documentPreviewSurface,
  isolatedHtmlDocument,
  markdownLineTarget,
  remoteDocumentDirectory,
  resolvePreviewableDocumentLink,
  type DocumentPreviewKind,
} from "./document-preview";
import { MarkdownLocalLinkProvider } from "./MarkdownLinkHandler";
import { useImagePreview } from "./ImagePreviewHost";
import { materializePrivateAsset } from "./private-asset";
import { RichMarkdown, RichMarkdownTextScaleProvider } from "./RichMarkdown";
import type { ContentReviewTarget } from "./content-review";
import { RichContentWidthProvider } from "./RichContentLayout";
import { useDocumentViewerPreferences } from "./use-document-viewer-preferences";

export type DocumentPreviewRequest = {
  kind: DocumentPreviewKind;
  name: string;
  path: string;
  source?: PrivateAssetSource;
  line?: number;
  column?: number;
  getTransferAccess: GetTransferAccess;
};

function startDocumentDownload(request: DocumentPreviewRequest, directory: SelectedDirectory): RunningTransfer {
  const source = request.source ?? { kind: "path" as const, path: request.path };
  if (source.kind === "scoped") {
    return startDownload(request.getTransferAccess, directory, source.rootId, source.path, () => undefined);
  }
  if (source.kind === "path") {
    return startPreviewDownload(request.getTransferAccess, directory, source.path, () => undefined);
  }
  throw new Error("This attachment cannot be downloaded directly");
}

type PreviewState = DocumentPreviewRequest & { revision: number };
type CompletedTransfer = Awaited<RunningTransfer["promise"]>;
export type DocumentPreviewResult =
  | { phase: "loading" }
  | { phase: "ready"; source: string; segments: string[]; truncated: boolean }
  | { phase: "error"; message: string };
export const MAX_DOCUMENT_PREVIEW_BYTES = 2 * 1024 * 1024;

type DocumentPreviewController = {
  open(request: DocumentPreviewRequest, fullscreen: AppFullscreenOverlayController): void;
  download(request: DocumentPreviewRequest): Promise<void>;
};

const DocumentPreviewContext = createContext<DocumentPreviewController | null>(null);

/** Owns document preview above the virtualized timeline. Private files are
 * fetched with scoped auth into app-private storage; neither their URL nor
 * auth token is handed to a system browser. */
export function DocumentPreviewHost({ children }: { children: ReactNode }) {
  const dialog = useAppDialog();
  const { toast } = useToast();
  const openImagePreview = useImagePreview();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [result, setResult] = useState<DocumentPreviewResult>({ phase: "loading" });
  const previewLoadRef = useRef<AbortController | null>(null);
  const fullscreenRef = useRef<AppFullscreenOverlayController | null>(null);
  const revisionRef = useRef(0);
  const showDownloadComplete = (request: DocumentPreviewRequest, completed: CompletedTransfer) => {
    const toastId = "document-download-complete";
    const common = {
      id: toastId,
      variant: "success" as const,
      label: "File saved",
      description: request.name,
      duration: 6000,
      icon: <Ionicons name="checkmark-circle" size={22} color={colors.green} />,
    };
    if (completed.uri === undefined) {
      toast.show(common);
      return;
    }
    const uri = completed.uri;
    toast.show({
      id: toastId,
      duration: common.duration,
      component: (props) => (
        <Toast variant="success" placement="bottom" className="flex-row items-center gap-3" {...props}>
          {common.icon}
          <View style={styles.downloadToastContent}>
            <Toast.Title>{common.label}</Toast.Title>
            <Toast.Description>{common.description}</Toast.Description>
          </View>
          <Toast.Action
            variant="primary"
            size="sm"
            style={styles.downloadToastAction}
            onPress={() => {
              props.hide(toastId);
              void openDownloadedFile(uri, completed.mimeType).catch((cause: unknown) => {
                dialog.alert("Could not open file", cause instanceof Error ? cause.message : "No installed app can open this file");
              });
            }}
          >
            Open
          </Toast.Action>
        </Toast>
      ),
    });
  };
  const downloadFile = async (request: DocumentPreviewRequest): Promise<void> => {
    try {
      const directory = await pickDownloadDirectory();
      const transfer = startDocumentDownload(request, directory);
      const completed = await transfer.promise;
      showDownloadComplete(request, completed);
    } catch (cause) {
      if (isPickerCancellation(cause)) return;
      dialog.alert(
        "Download failed",
        cause instanceof Error ? cause.message : "Could not download file",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: () => void downloadFile(request) },
        ],
      );
    }
  };
  const beginPreviewLoad = (request: DocumentPreviewRequest, revision: number, fullscreen: AppFullscreenOverlayController) => {
    previewLoadRef.current?.abort();
    previewLoadRef.current = null;
    if (request.kind === "download") return;
    const controller = new AbortController();
    previewLoadRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && revisionRef.current === revision;
    if (request.kind === "image") {
      void (async () => {
        if (!isCurrent()) return;
        const uri = await materializePrivateAsset(request.source ?? { kind: "path", path: request.path }, request.getTransferAccess);
        if (!isCurrent()) return;
        openImagePreview({
          id: `remote-file:${request.path}`,
          label: request.name,
          source: { uri },
          reference: request.path,
          download: () => downloadFile(request),
        }, fullscreen);
      })().catch((cause: unknown) => {
        if (!isCurrent()) return;
        const message = cause instanceof Error ? cause.message : "Image preview failed";
        dialog.alert("Image preview failed", message, [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: () => open(request, fullscreen) },
        ]);
      });
      return;
    }
    void loadDocumentPreview(request, controller.signal).then(
      (loaded) => {
        if (!isCurrent()) return;
        setResult({
          phase: "ready",
          source: loaded.source,
          segments: request.kind === "markdown" ? projectCompleteMarkdown(loaded.source) : [],
          truncated: loaded.truncated,
        });
      },
      (cause) => {
        if (isCurrent()) setResult({ phase: "error", message: cause instanceof Error ? cause.message : "Document preview failed" });
      },
    );
  };
  const open = (request: DocumentPreviewRequest, fullscreen: AppFullscreenOverlayController) => {
    fullscreenRef.current = fullscreen;
    revisionRef.current += 1;
    const revision = revisionRef.current;
    const surface = documentPreviewSurface(request.kind);
    if (surface === "download") {
      void downloadFile(request);
      return;
    }
    if (surface === "image-viewer") {
      beginPreviewLoad(request, revision, fullscreen);
      return;
    }
    if (surface === "fullscreen") {
      fullscreen.present(({ close }) => (
        <FullscreenDocumentPreview
          request={request}
          onClose={close}
          onDownload={() => void downloadFile(request)}
          onOpen={(nested) => open(nested, fullscreen)}
        />
      ));
      return;
    }
    setResult({ phase: "loading" });
    setPreview({ ...request, revision });
    beginPreviewLoad(request, revision, fullscreen);
  };
  const close = () => {
    revisionRef.current += 1;
    previewLoadRef.current?.abort();
    previewLoadRef.current = null;
    setPreview(null);
  };
  const retry = () => {
    if (preview === null || fullscreenRef.current === null) return;
    revisionRef.current += 1;
    const revision = revisionRef.current;
    setResult({ phase: "loading" });
    setPreview({ ...preview, revision });
    beginPreviewLoad(preview, revision, fullscreenRef.current);
  };
  const previewBody = result.phase === "loading" ? (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.secondary}>Loading document…</Text>
    </View>
  ) : result.phase === "error" ? (
    <View style={styles.center}>
      <Text selectable style={styles.error}>{result.message}</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
        <Ionicons name="refresh" size={18} color={colors.onPrimary} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  ) : null;
  const previewSurface = preview === null ? null : documentPreviewSurface(preview.kind);
  return (
    <DocumentPreviewContext.Provider value={{ open, download: downloadFile }}>
      {children}
      <AppSheet
        isOpen={previewSurface === "sheet"}
        onOpenChange={(open) => { if (!open) close(); }}
        contentProps={{
          index: 0,
          snapPoints: ["60%", "90%"],
          enableDynamicSizing: false,
          enableOverDrag: false,
          contentContainerClassName: "h-full",
        }}
      >
        <DocumentHeader
          icon={previewIcon(preview?.kind)}
          title={preview?.name ?? "File"}
          close={close}
          {...(preview === null ? {} : { onDownload: () => void downloadFile(preview) })}
        />
        {previewBody ?? (result.phase === "ready" && (
            <AppSheetScrollView
              style={styles.scroll}
              contentContainerStyle={styles.document}
              keyboardShouldPersistTaps="handled"
            >
              <Text selectable style={styles.textPreview}>{result.source}</Text>
              {result.truncated && <Text style={styles.secondary}>Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes. Download the file to read the rest.</Text>}
            </AppSheetScrollView>
        ))}
      </AppSheet>

    </DocumentPreviewContext.Provider>
  );
}

function FullscreenDocumentPreview({
  request,
  onClose,
  onDownload,
  onOpen,
}: {
  request: DocumentPreviewRequest;
  onClose(): void;
  onDownload(): void;
  onOpen(request: DocumentPreviewRequest): void;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<DocumentPreviewResult>({ phase: "loading" });
  const [documentViewportWidth, setDocumentViewportWidth] = useState(0);
  const {
    preferences: { textScale, layoutMode },
    changeTextScale,
    resetTextScale,
    setLayoutMode,
  } = useDocumentViewerPreferences();
  const markdownScrollRef = useRef<ScrollView | null>(null);
  const scrolledMarkdownRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadDocumentPreview(request, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setResult({
          phase: "ready",
          source: loaded.source,
          segments: request.kind === "markdown" ? projectCompleteMarkdown(loaded.source) : [],
          truncated: loaded.truncated,
        });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setResult({ phase: "error", message: cause instanceof Error ? cause.message : "Document preview failed" });
      },
    );
    return () => controller.abort();
  }, [request, revision]);

  const markdownTarget = request.kind === "markdown" && result.phase === "ready"
    ? markdownLineTarget(result.source, result.segments, request.line)
    : null;
  const markdownReviewTarget: ContentReviewTarget | undefined = request.kind === "markdown"
    ? { id: `markdown-document:${request.path}`, label: request.name, reference: request.path }
    : undefined;
  const scrollToMarkdownTarget = (y: number) => {
    if (scrolledMarkdownRevisionRef.current === revision) return;
    scrolledMarkdownRevisionRef.current = revision;
    requestAnimationFrame(() => markdownScrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: false }));
  };
  const openNestedDocument = (href: string) => {
    const target = resolvePreviewableDocumentLink(href, remoteDocumentDirectory(request.path));
    if (target === null) return false;
    onOpen({ ...target, getTransferAccess: request.getTransferAccess });
    return true;
  };

  return (
    <View style={styles.browser}>
      <DocumentHeader
        icon={previewIcon(request.kind)}
        title={request.name}
        close={onClose}
        onDownload={onDownload}
        {...(request.kind === "markdown" ? {
          textScale,
          layoutMode,
          onDecreaseText: () => changeTextScale(-0.1),
          onResetText: resetTextScale,
          onIncreaseText: () => changeTextScale(0.1),
          onLayoutModeChange: setLayoutMode,
        } : {})}
      />
      {result.phase === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.secondary}>Loading document…</Text>
        </View>
      )}
      {result.phase === "error" && (
        <View style={styles.center}>
          <Text selectable style={styles.error}>{result.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            setResult({ phase: "loading" });
            setRevision((current) => current + 1);
          }} style={styles.retryButton}>
            <Ionicons name="refresh" size={18} color={colors.onPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {result.phase === "ready" && request.kind === "html" && (
        <WebView
          testID="html-document-preview"
          source={{ html: isolatedHtmlDocument(result.source), baseUrl: "about:blank" }}
          style={styles.webView}
          javaScriptEnabled={false}
          domStorageEnabled={false}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={({ url }) => {
            if (url === "about:blank") return true;
            if (isSafeLink(url)) void Linking.openURL(url);
            return false;
          }}
        />
      )}
      {result.phase === "ready" && request.kind !== "html" && (
        <ScrollView
          key={`markdown:${revision}`}
          ref={markdownScrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.documentScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.document,
              layoutMode === "reading" && styles.documentReading,
              layoutMode === "reading" && { maxWidth: documentReadingWidth(textScale) },
            ]}
            onLayout={({ nativeEvent }) => {
              const nextWidth = Math.max(0, Math.floor(nativeEvent.layout.width - spacing.md * 2));
              setDocumentViewportWidth((current) => current === nextWidth ? current : nextWidth);
            }}
          >
            <RichMarkdownTextScaleProvider scale={textScale}>
              <RichContentWidthProvider width={documentViewportWidth > 0 ? documentViewportWidth : null}>
                <MarkdownLocalLinkProvider onOpen={openNestedDocument}>
                  {result.segments.map((segment, index) => (
                    <MarkdownPreviewSegment
                      key={`${revision}:${index}`}
                      source={segment}
                      {...(markdownReviewTarget === undefined ? {} : { reviewTarget: markdownReviewTarget, reviewPathPrefix: `segment-${index}` })}
                      {...(markdownTarget?.segmentIndex === index ? {
                        targetLine: markdownTarget.line,
                        onTargetLayout: scrollToMarkdownTarget,
                      } : {})}
                    />
                  ))}
                </MarkdownLocalLinkProvider>
              </RichContentWidthProvider>
              {result.truncated && <Text style={styles.secondary}>Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes. Download the file to read the rest.</Text>}
            </RichMarkdownTextScaleProvider>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function MarkdownPreviewSegment({
  source,
  targetLine,
  onTargetLayout,
  reviewTarget,
  reviewPathPrefix,
}: {
  source: string;
  targetLine?: number;
  onTargetLayout?(y: number): void;
  reviewTarget?: ContentReviewTarget;
  reviewPathPrefix?: string;
}) {
  const segmentYRef = useRef<number | null>(null);
  const targetYRef = useRef<number | null>(null);
  const publishedRef = useRef(false);
  const publish = () => {
    if (publishedRef.current || onTargetLayout === undefined || segmentYRef.current === null || targetYRef.current === null) return;
    publishedRef.current = true;
    onTargetLayout(segmentYRef.current + targetYRef.current);
  };
  return (
    <View
      onLayout={({ nativeEvent }) => {
        segmentYRef.current = nativeEvent.layout.y;
        publish();
      }}
    >
      <RichMarkdown
        source={source}
        {...(reviewTarget === undefined ? {} : { reviewTarget })}
        {...(reviewPathPrefix === undefined ? {} : { reviewPathPrefix })}
        {...(targetLine === undefined ? {} : { targetLine })}
        {...(onTargetLayout === undefined ? {} : {
          onTargetLayout: (y: number) => {
            targetYRef.current = y;
            publish();
          },
        })}
      />
    </View>
  );
}

function DocumentHeader({
  icon,
  title,
  close,
  onDownload,
  textScale,
  layoutMode,
  onDecreaseText,
  onResetText,
  onIncreaseText,
  onLayoutModeChange,
}: {
  icon: "document-text-outline" | "globe-outline" | "image-outline" | "download-outline";
  title: string;
  close(): void;
  onDownload?(): void;
  textScale?: number;
  layoutMode?: DocumentLayoutMode;
  onDecreaseText?(): void;
  onResetText?(): void;
  onIncreaseText?(): void;
  onLayoutModeChange?(mode: DocumentLayoutMode): void;
}) {
  const actions: ActionMenuItem[] = [
    ...(onDownload === undefined ? [] : [{ id: "download", label: "Download", icon: "download-outline" as const }]),
    ...(layoutMode === undefined ? [] : [
      { id: "layout-reading", label: "Reading width", icon: "contract-outline" as const, selected: layoutMode === "reading" },
      { id: "layout-wide", label: "Full width", icon: "expand-outline" as const, selected: layoutMode === "wide" },
    ]),
  ];
  const onSelect = (id: string) => {
    if (id === "download") onDownload?.();
    else if (id === "layout-reading") onLayoutModeChange?.("reading");
    else if (id === "layout-wide") onLayoutModeChange?.("wide");
  };
  const textScaleControl = textScale === undefined ? undefined : (
    <DocumentTextScaleControl
      value={textScale}
      {...(onDecreaseText === undefined ? {} : { onDecrease: onDecreaseText })}
      {...(onResetText === undefined ? {} : { onReset: onResetText })}
      {...(onIncreaseText === undefined ? {} : { onIncrease: onIncreaseText })}
    />
  );
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back from document preview" onPress={close} style={styles.iconButton}>
        <Ionicons name="arrow-back" size={21} color={colors.text} />
      </Pressable>
      <Ionicons name={icon} size={20} color={colors.textMuted} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={styles.title}>{title}</Text>
      {(actions.length > 0 || textScaleControl !== undefined) && (
        <ActionMenu
          accessibilityLabel={`Document actions for ${title}`}
          actions={actions}
          controls={textScaleControl}
          onSelect={onSelect}
        >
          <Pressable accessibilityRole="button" accessibilityLabel={`Document actions for ${title}`} style={styles.iconButton}>
            <Ionicons name="ellipsis-vertical" size={21} color={colors.text} />
          </Pressable>
        </ActionMenu>
      )}
    </View>
  );
}

function DocumentTextScaleControl({
  value,
  onDecrease,
  onReset,
  onIncrease,
}: {
  value: number;
  onDecrease?(): void;
  onReset?(): void;
  onIncrease?(): void;
}) {
  const decreaseDisabled = value <= 0.8 || onDecrease === undefined;
  const increaseDisabled = value >= 1.4 || onIncrease === undefined;
  return (
    <View accessibilityRole="adjustable" accessibilityLabel="Document text size" style={styles.textScaleMenuItem}>
      <Ionicons name="text-outline" size={18} color={colors.textMuted} />
      <Text style={styles.textScaleMenuLabel}>Text size</Text>
      <View style={styles.textScaleStepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease document text size"
          disabled={decreaseDisabled}
          onPress={onDecrease}
          style={({ pressed }) => [styles.textScaleStepButton, decreaseDisabled && styles.textScaleStepDisabled, pressed && styles.textScaleStepPressed]}
        >
          <Ionicons name="remove" size={17} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset document text size"
          accessibilityHint="Resets text size to 100 percent"
          onPress={onReset}
          style={({ pressed }) => [styles.textScaleValueButton, pressed && styles.textScaleStepPressed]}
        >
          <Text numberOfLines={1} style={styles.textScaleValue}>{Math.round(value * 100)}%</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase document text size"
          disabled={increaseDisabled}
          onPress={onIncrease}
          style={({ pressed }) => [styles.textScaleStepButton, increaseDisabled && styles.textScaleStepDisabled, pressed && styles.textScaleStepPressed]}
        >
          <Ionicons name="add" size={17} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

export function useDocumentPreview(): (request: DocumentPreviewRequest) => void {
  const controller = useContext(DocumentPreviewContext);
  const fullscreen = useAppFullscreenOverlay();
  if (controller === null) throw new Error("useDocumentPreview must be used inside DocumentPreviewHost");
  return (request) => controller.open(request, fullscreen);
}

export function useDocumentDownload(): (request: DocumentPreviewRequest) => Promise<void> {
  const controller = useContext(DocumentPreviewContext);
  if (controller === null) throw new Error("useDocumentDownload must be used inside DocumentPreviewHost");
  return controller.download;
}

function previewIcon(kind: DocumentPreviewKind | undefined): "document-text-outline" | "globe-outline" | "image-outline" | "download-outline" {
  if (kind === "html") return "globe-outline";
  if (kind === "image") return "image-outline";
  if (kind === "download") return "download-outline";
  return "document-text-outline";
}

export async function loadDocumentPreview(request: DocumentPreviewRequest, signal: AbortSignal): Promise<{ source: string; truncated: boolean }> {
  const loaded = await readPrivateAssetText(
    request.source ?? { kind: "path", path: request.path },
    request.getTransferAccess,
    {
      limit: MAX_DOCUMENT_PREVIEW_BYTES,
      accept: request.kind === "markdown"
      ? "text/markdown, text/plain;q=0.9, */*;q=0.1"
      : request.kind === "text"
        ? "text/plain, application/json;q=0.9, application/xml;q=0.8, */*;q=0.1"
        : "text/html, application/xhtml+xml;q=0.9, text/plain;q=0.5, */*;q=0.1",
      signal,
    },
  );
  return { source: loaded.text, truncated: loaded.truncated };
}

const styles = StyleSheet.create({
  downloadToastContent: { flex: 1, minWidth: 0 },
  downloadToastAction: { backgroundColor: colors.primary },
  browser: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  header: { width: "100%", minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { minWidth: 0, flex: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "700" },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  textScaleMenuItem: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  textScaleMenuLabel: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, lineHeight: 20, fontFamily: "RobotoFlex-Medium" },
  textScaleStepper: { height: 36, flexDirection: "row", alignItems: "stretch", overflow: "hidden", borderRadius: 12, backgroundColor: colors.border, gap: 1 },
  textScaleStepButton: { width: 38, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerHigh },
  textScaleValueButton: { minWidth: 58, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs, backgroundColor: colors.surfaceContainerHigh },
  textScaleValue: { color: colors.text, fontSize: 13, lineHeight: 18, fontFamily: "RobotoFlex-Medium", fontVariant: ["tabular-nums"] },
  textScaleStepDisabled: { opacity: 0.35 },
  textScaleStepPressed: { backgroundColor: colors.surfaceContainerHighest },
  center: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  secondary: { color: colors.textMuted },
  error: { maxWidth: 480, color: colors.red, textAlign: "center" },
  retryButton: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: 21, backgroundColor: colors.accent, paddingHorizontal: spacing.md },
  retryText: { color: colors.onPrimary, fontWeight: "700" },
  scroll: { flex: 1, minHeight: 0, width: "100%" },
  documentScrollContent: { width: "100%", minWidth: 0, alignItems: "center" },
  document: { width: "100%", minWidth: 0, alignSelf: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  documentReading: { width: "100%" },
  textPreview: { width: "100%", color: colors.text, fontFamily: "monospace", fontSize: 12, lineHeight: 17 },
  webView: { flex: 1, minHeight: 0, backgroundColor: colors.background },
});

function isPickerCancellation(cause: unknown): boolean {
  return cause instanceof Error && /cancel(?:led|ed)?/iu.test(cause.message);
}

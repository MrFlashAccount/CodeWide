import { projectCompleteMarkdown } from "@codewide/rendering-core";
import { Ionicons } from "@expo/vector-icons";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import {
  colors,
  spacing,
  typeScale,
  typeWeight,
  iconSize,
  controlSize,
  layoutSize,
  radii,
} from "../theme";
import {
  privateAssetCacheKey,
  readPrivateAssetText,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";
import { documentReadingWidth, type DocumentLayoutMode } from "../data/user-preferences";
import {
  openDownloadedFile,
  pickDownloadDirectory,
  startDownload,
  startPreviewDownload,
  type RunningTransfer,
  type SelectedDirectory,
} from "../native/file-transfer";
import { useEvent } from "../react/useEvent";
import {
  useAppFullscreenOverlay,
  type AppFullscreenOverlayController,
} from "../ui/AppFullscreenOverlay";
import { ActionMenu, type ActionMenuItem } from "../ui/ActionMenu";
import { useAppDialog } from "../ui/AppDialog";
import { useAppNotice } from "../ui/useAppNotice";
import { AppText as Text } from "../ui/Typography";
import {
  interactiveHtmlDocument,
  markdownLineTarget,
  remoteDocumentDirectory,
  resolvePreviewableDocumentLink,
  type DocumentPreviewKind,
} from "./document-preview";
import { MarkdownLocalLinkProvider } from "./MarkdownLinkHandler";
import { useImagePreview } from "./ImagePreviewHost";
import { materializePrivateAsset } from "./private-asset";
import { RichMarkdownTextScaleProvider } from "./RichMarkdown";
import type { ContentReviewTarget } from "./content-review";
import { ContentReviewComments, ContentReviewComposer } from "./ContentReviewHost";
import { MarkdownDocumentView } from "./MarkdownDocumentView";
import { useEphemeralAsyncResource } from "./async-resource-store";
import { useDocumentViewerPreferences } from "./use-document-viewer-preferences";
import {
  DiagramPreviewViewportProvider,
  useDiagramPreviewViewportController,
} from "./DiagramPreviewViewport";

type DocumentPreviewRequestBase = {
  column?: number;
  getTransferAccess: GetTransferAccess;
  line?: number;
  name: string;
  path: string;
  source?: PrivateAssetSource;
};

export type DocumentPreviewRequest = {
  [Kind in DocumentPreviewKind]: DocumentPreviewRequestBase & { readonly kind: Kind };
}[DocumentPreviewKind];

function startDocumentDownload(
  request: DocumentPreviewRequest,
  directory: SelectedDirectory,
): RunningTransfer {
  const source = request.source ?? { kind: "path" as const, path: request.path };
  if (source.kind === "scoped") {
    return startDownload(
      request.getTransferAccess,
      directory,
      source.rootId,
      source.path,
      () => undefined,
    );
  }
  if (source.kind === "path") {
    return startPreviewDownload(request.getTransferAccess, directory, source.path, () => undefined);
  }
  throw new Error("This attachment cannot be downloaded directly");
}

type CompletedTransfer = Awaited<RunningTransfer["promise"]>;
export type DocumentPreviewResult =
  | { phase: "loading" }
  | { phase: "ready"; segments: string[]; source: string; truncated: boolean }
  | { message: string; phase: "error" };
export const MAX_DOCUMENT_PREVIEW_BYTES = 2 * 1024 * 1024;

type DocumentPreviewController = {
  download: (request: DocumentPreviewRequest) => Promise<void>;
  open: (request: DocumentPreviewRequest, fullscreen: AppFullscreenOverlayController) => void;
};

const DocumentPreviewContext = createContext<DocumentPreviewController | null>(null);

async function runDocumentDownload(
  request: DocumentPreviewRequest,
  onComplete: (request: DocumentPreviewRequest, completed: CompletedTransfer) => void,
  onFailure: (error: unknown, retry: () => void) => void,
): Promise<void> {
  try {
    const directory = await pickDownloadDirectory();
    const transfer = startDocumentDownload(request, directory);
    const completed = await transfer.promise;
    onComplete(request, completed);
  } catch (error) {
    if (isPickerCancellation(error)) {
      return;
    }
    onFailure(error, () => void runDocumentDownload(request, onComplete, onFailure));
  }
}

function loadImagePreviewWithRetry(
  request: DocumentPreviewRequest,
  signal: AbortSignal,
  isCurrent: () => boolean,
  onReady: (source: { headers: Record<string, string>; uri: string }) => void,
  onFailure: (error: unknown, retry: () => void) => void,
): void {
  if (!isCurrent()) {
    return;
  }
  void materializePrivateAsset(request.source ?? { kind: "path", path: request.path }, {
    getAccess: request.getTransferAccess,
    signal,
    variant: "detail",
  }).then(
    (uri) => {
      if (isCurrent()) {
        onReady(uri);
      }
    },
    (error: unknown) => {
      if (!isCurrent()) {
        return;
      }
      onFailure(error, () => {
        loadImagePreviewWithRetry(request, signal, isCurrent, onReady, onFailure);
      });
    },
  );
}

type FullscreenDocumentPresentation = {
  readonly downloadFile: (request: DocumentPreviewRequest) => Promise<void>;
  readonly fullscreen: AppFullscreenOverlayController;
  readonly openDocument: (request: DocumentPreviewRequest) => void;
  readonly request: DocumentPagePreviewRequest;
};

function presentFullscreenDocument({
  downloadFile,
  fullscreen,
  openDocument,
  request,
}: FullscreenDocumentPresentation): void {
  fullscreen.present(({ close }) =>
    createElement(DocumentPagePreview, {
      onClose: close,
      onDownload: () => void downloadFile(request),
      onOpen: openDocument,
      request,
    }),
  );
}

/** Owns document preview above the virtualized timeline. Private files are
 * fetched with scoped auth into app-private storage; neither their URL nor
 * auth token is handed to a system browser. */
export function DocumentPreviewHost({ children }: { children: ReactNode }): React.JSX.Element {
  const dialog = useAppDialog();
  const notice = useAppNotice();
  const openImagePreview = useImagePreview();
  const previewLoadRef = useRef<AbortController | null>(null);
  const revisionRef = useRef(0);
  const showDownloadComplete = (request: DocumentPreviewRequest, completed: CompletedTransfer) => {
    const common = {
      description: request.name,
      duration: 6000,
      icon: <Ionicons color={colors.green} name="checkmark-circle" size={iconSize.navigation} />,
      label: "File saved",
    };
    if (completed.uri === undefined) {
      notice.show(common);
      return;
    }
    const uri = completed.uri;
    notice.show({
      ...common,
      actionLabel: "Open",
      onActionPress: () => {
        void openDownloadedFile(uri, completed.mimeType).catch((error: unknown) => {
          dialog.alert(
            "Could not open file",
            error instanceof Error ? error.message : "No installed app can open this file",
          );
        });
      },
    });
  };
  const downloadFile = useEvent(async (request: DocumentPreviewRequest): Promise<void> =>
    runDocumentDownload(request, showDownloadComplete, (error, retryDownload) => {
      dialog.error("Download failed", error, [
        { style: "cancel", text: "Cancel" },
        { onPress: retryDownload, text: "Retry" },
      ]);
    }),
  );
  const beginImagePreviewLoad = (
    request: DocumentPreviewRequest,
    revision: number,
    fullscreen: AppFullscreenOverlayController,
  ) => {
    previewLoadRef.current?.abort();
    previewLoadRef.current = null;
    const controller = new AbortController();
    previewLoadRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && revisionRef.current === revision;
    loadImagePreviewWithRetry(
      request,
      controller.signal,
      isCurrent,
      (source) => {
        openImagePreview(
          {
            download: async () => downloadFile(request),
            id: `remote-file:${request.path}`,
            label: request.name,
            reference: request.path,
            source,
          },
          fullscreen,
        );
      },
      (error, retryImagePreview) => {
        dialog.error("Image preview failed", error, [
          { style: "cancel", text: "Cancel" },
          { onPress: retryImagePreview, text: "Retry" },
        ]);
      },
    );
  };
  const open = useEvent(
    (request: DocumentPreviewRequest, fullscreen: AppFullscreenOverlayController) => {
      const present = (currentRequest: DocumentPreviewRequest): void => {
        revisionRef.current += 1;
        const revision = revisionRef.current;
        previewLoadRef.current?.abort();
        previewLoadRef.current = null;
        if (currentRequest.kind === "download") {
          downloadFile(currentRequest).catch((error: unknown) => {
            dialog.error("Download failed", error);
          });
          return;
        }
        if (currentRequest.kind === "image") {
          beginImagePreviewLoad(currentRequest, revision, fullscreen);
          return;
        }
        presentFullscreenDocument({
          downloadFile,
          fullscreen,
          openDocument: present,
          request: currentRequest,
        });
      };
      present(request);
    },
  );
  return (
    <DocumentPreviewContext.Provider value={{ download: downloadFile, open }}>
      {children}
    </DocumentPreviewContext.Provider>
  );
}

export type DocumentPagePreviewRequest = Extract<
  DocumentPreviewRequest,
  { readonly kind: "html" | "markdown" | "text" }
>;

/** Renders text-backed attachments as a full page shared by Router and timeline previews. */
export function DocumentPagePreview({
  onClose,
  onDownload,
  onOpen,
  request,
}: {
  onClose: () => void;
  onDownload: () => void;
  onOpen: (request: DocumentPreviewRequest) => void;
  request: DocumentPagePreviewRequest;
}): React.JSX.Element {
  const resourceOwnerId = useId();
  const [revision, setRevision] = useState(0);
  const {
    changeTextScale,
    preferences: { layoutMode, textScale },
    resetTextScale,
    setLayoutMode,
  } = useDocumentViewerPreferences();
  const diagramViewport = useDiagramPreviewViewportController();
  const source = request.source ?? { kind: "path" as const, path: request.path };
  const previewResource = useEphemeralAsyncResource<
    Extract<DocumentPreviewResult, { phase: "ready" }>
  >(
    `fullscreen-document:${resourceOwnerId}:${privateAssetCacheKey(source)}`,
    `${request.kind}:${String(revision)}`,
    async (_publish, signal) => {
      const loaded = await loadDocumentPreview(request, signal);
      return {
        phase: "ready",
        segments: request.kind === "markdown" ? projectCompleteMarkdown(loaded.source) : [],
        source: loaded.source,
        truncated: loaded.truncated,
      };
    },
    (value) => value.source.length * 2,
  );
  const result: DocumentPreviewResult =
    previewResource.status === "ready" && previewResource.value !== null
      ? previewResource.value
      : previewResource.status === "error"
        ? { message: previewResource.error ?? "Document preview failed", phase: "error" }
        : { phase: "loading" };

  const markdownTarget =
    request.kind === "markdown" && result.phase === "ready"
      ? markdownLineTarget(result.source, result.segments, request.line)
      : null;
  const markdownReviewTarget: ContentReviewTarget | undefined =
    request.kind === "markdown"
      ? { id: `markdown-document:${request.path}`, label: request.name, reference: request.path }
      : undefined;
  const openNestedDocument = useEvent((href: string) => {
    const target = resolvePreviewableDocumentLink(href, remoteDocumentDirectory(request.path));
    if (target === null) {
      return false;
    }
    onOpen({ ...target, getTransferAccess: request.getTransferAccess });
    return true;
  });
  const retry = useEvent(() => {
    setRevision((current) => current + 1);
  });
  const decreaseTextScale = useEvent(() => {
    changeTextScale(-0.1);
  });
  const increaseTextScale = useEvent(() => {
    changeTextScale(0.1);
  });

  return (
    <View style={styles.browser}>
      <DocumentHeader
        close={onClose}
        icon={previewIcon(request.kind)}
        onDownload={onDownload}
        title={request.name}
        {...(request.kind === "markdown"
          ? {
              layoutMode,
              onDecreaseText: decreaseTextScale,
              onIncreaseText: increaseTextScale,
              onLayoutModeChange: setLayoutMode,
              onResetText: resetTextScale,
              textScale,
            }
          : {})}
      />
      {result.phase === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.secondary}>Loading document…</Text>
        </View>
      )}
      {result.phase === "error" && (
        <View style={styles.center}>
          <Text selectable style={styles.error}>
            {result.message}
          </Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
            <Ionicons color={colors.onPrimary} name="refresh" size={iconSize.action} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {result.phase === "ready" && request.kind === "html" && (
        <HtmlDocumentPreview source={result.source} />
      )}
      {result.phase === "ready" && request.kind === "text" && (
        <ScrollView
          contentContainerStyle={styles.document}
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
        >
          <Text selectable style={styles.textPreview}>
            {result.source}
          </Text>
          {result.truncated && (
            <Text style={styles.secondary}>
              Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes. Download the
              file to read the rest.
            </Text>
          )}
        </ScrollView>
      )}
      {result.phase === "ready" && request.kind === "markdown" && (
        <DiagramPreviewViewportProvider controller={diagramViewport}>
          <RichMarkdownTextScaleProvider scale={textScale}>
            <MarkdownLocalLinkProvider onOpen={openNestedDocument}>
              <MarkdownDocumentView
                key={`markdown:${String(revision)}`}
                segments={result.segments}
                target={markdownTarget}
                {...(markdownReviewTarget === undefined
                  ? {}
                  : { reviewTarget: markdownReviewTarget })}
                {...(layoutMode === "reading" ? { maxWidth: documentReadingWidth(textScale) } : {})}
                footer={
                  result.truncated ? (
                    <Text style={styles.secondary}>
                      Preview limited to {MAX_DOCUMENT_PREVIEW_BYTES.toLocaleString()} bytes.
                      Download the file to read the rest.
                    </Text>
                  ) : null
                }
                onScroll={diagramViewport.schedule}
                textScale={textScale}
              />
            </MarkdownLocalLinkProvider>
          </RichMarkdownTextScaleProvider>
        </DiagramPreviewViewportProvider>
      )}
      {markdownReviewTarget !== undefined && (
        <>
          <ContentReviewComments presentation="overlay" targetId={markdownReviewTarget.id} />
          <ContentReviewComposer anchorKind="text" targetId={markdownReviewTarget.id} />
        </>
      )}
    </View>
  );
}

function DocumentHeader({
  close,
  icon,
  layoutMode,
  onDecreaseText,
  onDownload,
  onIncreaseText,
  onLayoutModeChange,
  onResetText,
  textScale,
  title,
}: {
  close: () => void;
  icon: "document-text-outline" | "globe-outline" | "image-outline" | "download-outline";
  layoutMode?: DocumentLayoutMode;
  onDecreaseText?: () => void;
  onDownload?: () => void;
  onIncreaseText?: () => void;
  onLayoutModeChange?: (mode: DocumentLayoutMode) => void;
  onResetText?: () => void;
  textScale?: number;
  title: string;
}) {
  const actions: ActionMenuItem[] = [
    ...(onDownload === undefined
      ? []
      : [{ icon: "download-outline" as const, id: "download", label: "Download" }]),
    ...(textScale === undefined
      ? []
      : [
          {
            disabled: textScale <= 0.8 || onDecreaseText === undefined,
            icon: "remove" as const,
            id: "text-smaller",
            label: "Smaller",
            section: "Text size",
          },
          {
            disabled: onResetText === undefined,
            icon: "refresh" as const,
            id: "text-reset",
            label: `Reset to 100% (${String(Math.round(textScale * 100))}%)`,
            section: "Text size",
          },
          {
            disabled: textScale >= 1.4 || onIncreaseText === undefined,
            icon: "add" as const,
            id: "text-larger",
            label: "Larger",
            section: "Text size",
          },
        ]),
    ...(layoutMode === undefined
      ? []
      : [
          {
            icon: "contract-outline" as const,
            id: "layout-reading",
            label: "Reading width",
            selected: layoutMode === "reading",
          },
          {
            icon: "expand-outline" as const,
            id: "layout-wide",
            label: "Full width",
            selected: layoutMode === "wide",
          },
        ]),
  ];
  const onSelect = useEvent((id: string) => {
    if (id === "download") {
      onDownload?.();
    } else if (id === "text-smaller") {
      onDecreaseText?.();
    } else if (id === "text-reset") {
      onResetText?.();
    } else if (id === "text-larger") {
      onIncreaseText?.();
    } else if (id === "layout-reading") {
      onLayoutModeChange?.("reading");
    } else if (id === "layout-wide") {
      onLayoutModeChange?.("wide");
    }
  });
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Back from document preview"
        accessibilityRole="button"
        onPress={close}
        style={styles.iconButton}
      >
        <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
      </Pressable>
      <Ionicons color={colors.textMuted} name={icon} size={iconSize.action} />
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {actions.length > 0 && (
        <ActionMenu
          accessibilityLabel={`Document actions for ${title}`}
          actions={actions}
          onSelect={onSelect}
        >
          <Pressable
            accessibilityLabel={`Document actions for ${title}`}
            accessibilityRole="button"
            style={styles.iconButton}
          >
            <Ionicons color={colors.text} name="ellipsis-vertical" size={iconSize.action} />
          </Pressable>
        </ActionMenu>
      )}
    </View>
  );
}

export function useDocumentPreview(): (request: DocumentPreviewRequest) => void {
  const controller = useContext(DocumentPreviewContext);
  const fullscreen = useAppFullscreenOverlay();
  const open = useEvent((request: DocumentPreviewRequest) => {
    if (controller === null) {
      throw new Error("useDocumentPreview must be used inside DocumentPreviewHost");
    }
    controller.open(request, fullscreen);
  });
  if (controller === null) {
    throw new Error("useDocumentPreview must be used inside DocumentPreviewHost");
  }
  return open;
}

export function useDocumentDownload(): (request: DocumentPreviewRequest) => Promise<void> {
  const controller = useContext(DocumentPreviewContext);
  if (controller === null) {
    throw new Error("useDocumentDownload must be used inside DocumentPreviewHost");
  }
  return controller.download;
}

type HtmlDocumentPreviewProps = { source: string; testID?: string };

export function HtmlDocumentPreview(props: HtmlDocumentPreviewProps) {
  return (
    <WebView
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      domStorageEnabled
      javaScriptCanOpenWindowsAutomatically
      javaScriptEnabled
      mixedContentMode="always"
      nestedScrollEnabled
      originWhitelist={["*"]}
      setSupportMultipleWindows
      source={{ baseUrl: "about:blank", html: interactiveHtmlDocument(props.source) }}
      style={styles.webView}
      testID={props.testID ?? "html-document-preview"}
    />
  );
}

function previewIcon(
  kind: DocumentPreviewKind | undefined,
): "document-text-outline" | "globe-outline" | "image-outline" | "download-outline" {
  if (kind === "html") {
    return "globe-outline";
  }
  if (kind === "image") {
    return "image-outline";
  }
  if (kind === "download") {
    return "download-outline";
  }
  return "document-text-outline";
}

export async function loadDocumentPreview(
  request: DocumentPreviewRequest,
  signal: AbortSignal,
): Promise<{ source: string; truncated: boolean }> {
  const loaded = await readPrivateAssetText(
    request.source ?? { kind: "path", path: request.path },
    request.getTransferAccess,
    {
      accept:
        request.kind === "markdown"
          ? "text/markdown, text/plain;q=0.9, */*;q=0.1"
          : request.kind === "text"
            ? "text/plain, application/json;q=0.9, application/xml;q=0.8, */*;q=0.1"
            : "text/html, application/xhtml+xml;q=0.9, text/plain;q=0.5, */*;q=0.1",
      limit: MAX_DOCUMENT_PREVIEW_BYTES,
      signal,
    },
  );
  return { source: loaded.text, truncated: loaded.truncated };
}

const styles = StyleSheet.create({
  browser: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
  },
  center: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 180,
  },
  document: {
    alignSelf: "center",
    gap: spacing.sm,
    minWidth: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  downloadToastAction: {
    backgroundColor: colors.primary,
    minHeight: controlSize.regular,
  },
  downloadToastContent: {
    flex: 1,
    minWidth: 0,
  },
  error: {
    color: colors.red,
    maxWidth: 480,
    textAlign: "center",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.header,
    minWidth: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  iconButton: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  retryText: {
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  secondary: { color: colors.textMuted },
  textPreview: {
    color: colors.text,
    width: "100%",
    ...typeScale.code,
    fontFamily: "monospace",
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  webView: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
});

function isPickerCancellation(error: unknown): boolean {
  return error instanceof Error && /cancel(?:led|ed)?/iu.test(error.message);
}

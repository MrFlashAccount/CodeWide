import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { compactSource } from "../source-contract";
import { appRootProviders } from "./presentation-sources";
import { ownerUserMessageContent } from "./conversation-turns-sources";
import {
  documentPreviewHost,
  richMarkdown,
  imagePreviewHost,
  documentPreview,
  screen,
  codeReviewEditor,
  codeReviewRuntime,
  changeMenu,
  mermaidWeb,
} from "./platform-sources";
import { ownerThreadTimeline } from "./conversation-timeline-sources";
import {
  migratedDocumentNavigation,
  migratedAttachmentDocumentPreview,
  migratedAttachmentsFeature,
  migratedAttachmentPreview,
} from "./attachments-sources";
import { ownerAttachmentAdmission, ownerDraft } from "./composer-sources";
import { migratedChangesFeature, migratedThreadResourceContextChips } from "./changes-sources";
import {
  ownerReviewSubmission,
  ownerCodeReviewResources,
  codeReviewWorkspace,
  ownerReviewVoice,
  reviewVoiceOwner,
  ownerCodeReviewMenu,
  ownerCodeReviewState,
} from "./review-sources";
import { codeReviewAsset, nativeEngine } from "./native-sources";
import { threadSearch } from "./search-sources";
import { voiceWorkspace, ownerCatalogLifecycle } from "./runtime-sources";
import {
  threadDetailDatabase,
  ownerThreadSyncRuntime,
  ownerThreadSyncRemoteLoader,
  reconnectOwner,
  ownerThreadSyncForeground,
} from "./thread-runtime-sources";
import { navigationActions } from "./navigation-sources";
import { ownerConversationPresentation } from "./conversation-composition-sources";
import { newChat } from "./projects-sources";

const ownerAttachmentDocumentResource = readFileSync(
  new URL("../../src/features/attachments/attachmentDocumentResource.ts", import.meta.url),
  "utf8",
);

it("renders attached Markdown and isolated HTML with the reusable document preview", () => {
  expect(appRootProviders).toContain("<ImagePreviewHost>");
  expect(appRootProviders).toContain("<DocumentPreviewHost>");
  expect(appRootProviders).toContain("<AppFullscreenOverlayHost />");
  expect(ownerUserMessageContent).toContain("<MessageAttachmentCard");
  expect(documentPreviewHost).toContain("readPrivateAssetText(");
  expect(documentPreviewHost).toContain('{ kind: "path", path: request.path }');
  expect(documentPreviewHost).toContain("projectCompleteMarkdown(loaded.source)");
  expect(ownerThreadTimeline).toContain(
    "<MarkdownLocalLinkProvider onOpen={props.openThreadDocumentLink}>",
  );
  expect(migratedDocumentNavigation).toContain("resolvePreviewableDocumentLink(href, sourceCwd)");
  expect(richMarkdown).toContain("useMarkdownLocalLinkHandler()");
  expect(documentPreviewHost).toContain("<MarkdownDocumentView");
  expect(documentPreviewHost).toContain("target={markdownTarget}");
  expect(documentPreviewHost).toContain('isOpen={previewSurface === "sheet"}');
  expect(documentPreviewHost).toContain('snapPoints: ["60%", "90%"]');
  expect(documentPreviewHost).toContain('if (surface === "fullscreen")');
  expect(documentPreviewHost).toContain(
    "presentFullscreenDocument(fullscreen, request, downloadFile)",
  );
  expect(documentPreviewHost).not.toContain('<Modal visible={previewSurface === "browser"}');
  expect(documentPreviewHost).toContain('surface === "image-viewer"');
  expect(documentPreviewHost).toContain('surface === "download"');
  expect(documentPreviewHost).toContain(
    "startPreviewDownload(request.getTransferAccess, directory, source.path",
  );
  expect(documentPreviewHost).toMatch(
    /startDownload\(\s*request\.getTransferAccess,\s*directory,\s*source\.rootId,\s*source\.path/u,
  );
  expect(documentPreviewHost).toContain("startDocumentDownload(request, directory)");
  expect(documentPreviewHost).toContain("void materializePrivateAsset(");
  expect(documentPreviewHost).toContain("source,");
  expect(documentPreviewHost).toMatch(/openImagePreview\(\s*\{/u);
  expect(documentPreviewHost).toContain("onDownload");
  expect(imagePreviewHost).toContain('id: "download"');
  expect(imagePreviewHost).toContain('label: "Download"');
  expect(imagePreviewHost).toContain('accessibilityLabel="Image actions"');
  expect(documentPreviewHost).toContain('props.testID ?? "html-document-preview"');
  expect(documentPreviewHost).toContain("javaScriptEnabled\n");
  expect(documentPreviewHost).toContain("javaScriptCanOpenWindowsAutomatically\n");
  expect(documentPreviewHost).toContain('originWhitelist={["*"]}');
  expect(documentPreviewHost).toContain("allowFileAccess\n");
  expect(documentPreviewHost).toContain("allowFileAccessFromFileURLs\n");
  expect(documentPreviewHost).toContain("allowUniversalAccessFromFileURLs\n");
  expect(documentPreviewHost).toContain("domStorageEnabled\n");
  expect(documentPreviewHost).toContain('mixedContentMode="always"');
  expect(documentPreviewHost).toContain("setSupportMultipleWindows\n");
  expect(documentPreviewHost).not.toContain("onShouldStartLoadWithRequest");
  expect(documentPreview).not.toContain("Content-Security-Policy");
  expect(ownerAttachmentAdmission).toContain("const selected = await pickUploadFile()");
  expect(ownerAttachmentAdmission).toContain("rootId: ATTACHMENT_ROOT_ID");
  expect(ownerAttachmentAdmission).toContain(
    "const remotePath = attachmentUploadPath(draftThreadId, selected.name)",
  );
  expect(screen).not.toContain("function FileTransferSheet");
  expect(screen).not.toContain('values={["Upload", "Download"]}');
  expect(screen).not.toContain('label="Server root id"');
  expect(migratedAttachmentDocumentPreview).toContain('accessibilityLabel="Back to attachments"');
  expect(migratedAttachmentsFeature).toContain("if (!open)");
  expect(migratedAttachmentsFeature).toContain(
    "(document === null ? closeSheet : navigateBack)();",
  );
  expect(ownerAttachmentDocumentResource).toMatch(
    /useEphemeralAsyncResource<\s*Extract<DocumentPreviewResult/u,
  );
  expect(ownerAttachmentDocumentResource).toContain(
    "await loadDocumentPreview(document.request, signal)",
  );
  expect(screen).not.toContain("openAfterClose");
});

it("keeps code review readonly, offline and attached as one structured artifact", () => {
  expect(migratedChangesFeature).toContain("<CodeReviewWorkspace");
  expect(ownerReviewSubmission).toContain("serializeCodeReviewAttachment(comments)");
  expect(ownerReviewSubmission).toContain("`codex-review-${new Date().toISOString()");
  expect(migratedChangesFeature).toContain("function CurrentChangesRoute(");
  expect(screen).not.toContain(
    'void onLoadThreadResources(changesPreferences.scope ?? undefined, "changes").then(',
  );
  expect(migratedChangesFeature).toMatch(
    /onInitialLoad:\s*async\s*\(\)\s*=>\s*loadResources\(scope,\s*"changes",?\s*\)/u,
  );
  expect(ownerCodeReviewResources).toContain("useAsyncResource<ThreadResourcesValue>(");
  expect(ownerCodeReviewResources).toContain("if (shouldLoadInitialScope)");
  expect(ownerCodeReviewResources).toContain("return onInitialLoad()");
  expect(ownerCodeReviewResources).toContain("return onLoadScope(requestedScope)");
  expect(codeReviewWorkspace).not.toContain("void onInitialLoad().then(");
  expect(migratedChangesFeature).toContain("onClose={onClose}");
  expect(codeReviewWorkspace).toContain("files={reviewFiles}");
  expect(codeReviewWorkspace).toContain("document={document}");
  expect(codeReviewWorkspace).toContain("loading={loading}");
  expect(codeReviewWorkspace).not.toContain("{!loading && document !== null && <CodeReviewEditor");
  expect(ownerReviewVoice).toContain("voiceController.toggle(voiceScope)");
  expect(reviewVoiceOwner).toContain("useVoiceInputResource(voiceRuntime, voiceScope)");
  expect(ownerCodeReviewState).toContain("onAttach(comments)");
  expect(codeReviewEditor).toContain("file:///android_asset/code-review-editor.html");
  expect(codeReviewEditor).toContain("allowUniversalAccessFromFileURLs={false}");
  expect(codeReviewEditor).toContain("document: CodeReviewDocument | null;");
  expect(codeReviewEditor).not.toContain("showInitialLoading");
  expect(codeReviewRuntime).toContain(
    "setEmptyState(previewEmptyHost, LOADING_CHANGE_STATE, true)",
  );
  expect(migratedChangesFeature).toContain("initialLine: document.line");
  expect(migratedChangesFeature).toContain("initialColumn: document.column");
  expect(codeReviewWorkspace).toContain(
    "revealReference={selectedReference === null ? revealReference : null}",
  );
  expect(codeReviewWorkspace).toContain('accessibilityLabel="Changes options"');
  expect(codeReviewWorkspace).toContain('name="ellipsis-vertical"');
  expect(ownerCodeReviewState).toMatch(
    /\{(?=[^}]*id: "download")(?=[^}]*section: "File")(?=[^}]*label: "Download")(?=[^}]*icon: "download-outline" as const)[^}]*\}/u,
  );
  expect(ownerCodeReviewState).toContain('if (id === "download")');
  expect(ownerCodeReviewState).toContain("onDownload?.();");
  expect(codeReviewWorkspace).not.toContain('accessibilityLabel="Download file"');
  expect(changeMenu).toContain('section: "Changes"');
  expect(ownerCodeReviewMenu).toContain('section: "Layout"');
  expect(ownerCodeReviewMenu).toContain('section: "Display"');
  expect(ownerCodeReviewMenu).toContain('label: "Wrap lines"');
  expect(ownerCodeReviewMenu).not.toContain('label: "Default"');
  expect(migratedThreadResourceContextChips).toContain('trigger="long-press"');
  expect(migratedThreadResourceContextChips).toContain(
    "actions={changeScopeMenuActions(changeScopes, changeScope)}",
  );
  expect(migratedThreadResourceContextChips).toContain('accessibilityLabel="Choose changes scope"');
  expect(codeReviewEditor).toContain('send({ command: "reveal", payload: revealReference })');
  expect(codeReviewRuntime).toContain('side: reveal.side === "old" ? "deletions" : "additions"');
  expect(codeReviewRuntime).toContain('scrollIntoView({ block: "center", inline: "nearest" })');
  expect(codeReviewRuntime).toContain("new PierreFile<AnnotationMetadata>");
  expect(codeReviewRuntime).toContain("new FileDiff<AnnotationMetadata>");
  expect(codeReviewRuntime).toContain('icons: "complete"');
  expect(codeReviewRuntime).toContain('density: "compact"');
  expect(codeReviewRuntime).not.toContain('"list.hoverBackground"');
  expect(codeReviewRuntime).toContain("stickyFolders: false");
  expect(codeReviewRuntime).toContain("const FILE_TREE_OVERSCAN = 4");
  expect(codeReviewRuntime).toContain("overscan: FILE_TREE_OVERSCAN");
  expect(codeReviewRuntime).toContain("themeToTreeStyles(treeTheme)");
  expect(codeReviewRuntime).toContain("treeContainer.style.setProperty(property, value)");
  expect(codeReviewRuntime).not.toContain("Object.assign(treeContainer.style, treeThemeStyles)");
  expect(codeReviewRuntime).toContain(
    "new Map(payload.files.map((file) => [file.treePath, file]))",
  );
  expect(codeReviewRuntime).toContain("if (nextTreePath === selectedTreePath && !scroll)");
  expect(codeReviewRuntime).toContain("if (currentWorkspace.files.length === 0)");
  expect(codeReviewRuntime).toContain("else if (currentWorkspace.selectedPath !== null)");
  expect(codeReviewRuntime).toContain("codeReviewDocumentEmptyState(document, currentMode)");
  expect(codeReviewRuntime).toContain("renderCurrentDocument(true)");
  expect(codeReviewRuntime).toContain("forceRender,");
  expect(codeReviewRuntime).toContain("unsafeCSS: TOUCH_FILE_TREE_CSS");
  expect(codeReviewRuntime).toContain("@media (hover: none), (pointer: coarse)");
  expect(codeReviewRuntime).toContain('[data-type="item"]:hover:not([data-item-selected="true"])');
  expect(codeReviewRuntime).not.toContain("class ReviewLineMarker extends GutterMarker");
  expect(codeReviewRuntime).toContain(
    "openComposer(referenceForFileLine(currentDocument.path, event.lineNumber))",
  );
  expect(codeReviewAsset).toMatch(/code-review-editor\.js\?v=[a-f0-9]{16}/);
  expect(codeReviewAsset).not.toContain("--trees-bg-override");
  expect(codeReviewAsset).not.toContain("--trees-level-gap-override");
  expect(codeReviewAsset).toContain("padding-top: 10px;");
  expect(codeReviewAsset).toMatch(
    /#workspace\[data-sidebar-open="false"\] #preview-panel\s*\{\s*border-radius: 16px;\s*\}/u,
  );
  expect(codeReviewAsset).toContain('id="tree-empty"');
  expect(codeReviewAsset).toContain('id="preview-empty"');
});

it("keeps async data ownership in resources and event-driven preview controllers", () => {
  expect(threadSearch).toContain(
    'native && sidebarProject === null ? "mobile-thread-search" : null',
  );
  expect(screen).not.toContain("active-thread-hydration");
  expect(voiceWorkspace).toContain(
    "details.setRemoteLoader(createThreadSyncRemoteLoader(details, workspaceThreadSync))",
  );
  expect(threadDetailDatabase).toContain("await loader.hydrateWindow({");
  expect(navigationActions).toContain(
    "const selectThread = useEvent((selectionKey: string | null): void => {",
  );
  expect(navigationActions).toMatch(
    /\.observeThread\(params\.connectionId\.value, params\.threadId\.value\)/u,
  );
  expect(ownerConversationPresentation).toContain(
    'item.kind === "optimistic" && pendingDeliveryMayOwnTurn(item.status)',
  );
  expect(ownerThreadSyncRuntime).toContain("threadObserverDesired.set(connectionId, threadId)");
  expect(threadDetailDatabase).toContain("remoteLoader?.observe?.({ connectionId, threadId })");
  expect(ownerThreadSyncRemoteLoader).toContain('event: "thread.observer.attach_failed"');
  expect(reconnectOwner).toContain('event: "thread.reconnect_sync.failed"');
  expect(ownerThreadSyncRuntime).toContain('"companion/thread/sync"');
  expect(nativeEngine).toContain("async reattachRuntime(): Promise<void>");
  expect(nativeEngine).toContain("await session.reattachRuntime()");
  expect(ownerThreadSyncForeground).toContain("await supervisor.reattachRuntime(connectionId)");
  expect(reconnectOwner).toMatch(
    /sync\s*\.readThread\(row.connectionId, desiredThreadId, undefined, true\)/u,
  );
  expect(ownerCatalogLifecycle).toContain(
    'AppState.addEventListener("change", repairForegroundRuntime)',
  );
  expect(screen).not.toContain("refreshIfSelected");
  expect(navigationActions).toContain("open({");
  expect(navigationActions).toContain('mode: same ? "replace" : router.selectionMode');
  expect(navigationActions).toContain("navigationId,");
  expect(navigationActions).toContain("params,");
  expect(navigationActions).toContain("setActiveConnection(params.connectionId.value)");
  expect(screen).not.toContain("setActiveServerId(parsed.connectionId);\n      setActiveThreadId(");
  expect(newChat).toContain("newThreadService.open(connectionId, cwd)");
  expect(screen).not.toContain("setNewChatDraft(");
  expect(screen).not.toContain("active-thread-lifecycle-repair");
  expect(ownerDraft).toContain("`composer-seed:${composerScope}`");
  expect(screen).not.toContain("setMobileRemoteSearch");
  expect(documentPreviewHost).toContain(
    "presentFullscreenDocument(fullscreen, request, downloadFile)",
  );
  expect(compactSource(documentPreviewHost)).toContain(
    "useEphemeralAsyncResource< Extract<DocumentPreviewResult",
  );
  expect(documentPreviewHost).toContain("await loadDocumentPreview(preview, signal)");
  expect(mermaidWeb).not.toContain("useEffect(");
  expect(mermaidWeb).toContain("useAsyncResource");
  expect(imagePreviewHost).toContain("const handleAnnotation = useEvent(handler)");
  expect(imagePreviewHost).toContain(
    "registerAnnotationHandler(async (item, onAttached) => handleAnnotation(item, onAttached))",
  );
});

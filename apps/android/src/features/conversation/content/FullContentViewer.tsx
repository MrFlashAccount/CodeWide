import type { FullContentViewerProps } from "./FullContentViewer.types";
import { renderFullContentViewerBody } from "./FullContentViewerBody";
/** V1 FullContentViewer owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock, type RenderContentReference } from "@codewide/renderers";
import { useContext, useId, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { readPrivateAssetText, type PrivateAssetTextResult } from "../../../data/private-transfer";
import { useEvent } from "../../../react/useEvent";
import { useEphemeralAsyncResource } from "../../../rendering/async-resource-store";
import { colors } from "../../../theme";
import { useAppFullscreenOverlay } from "../../../ui/AppFullscreenOverlay";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { CONTENT_VIEW_CHUNK_BYTES } from "./contentLimits";
import { LargeContentViewerContext, type LargeContentViewerRequest } from "./contentViewerContext";
import { styles } from "./FullContentViewer.styles";

export function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export type LargeContentViewerSelection = LargeContentViewerRequest & {
  offset: number;
  nextOffset: number;
  text: string | null;
  loading: boolean;
  error: string | null;
};

export function LargeContentViewerHost({ children }: { children: ReactNode }) {
  const fullscreenOverlay = useAppFullscreenOverlay();
  const open = useEvent((request: LargeContentViewerRequest) => {
    fullscreenOverlay.present(({ close }) => (
      <LargeContentViewerSession initialRequest={request} onClose={close} />
    ));
  });
  return (
    <LargeContentViewerContext.Provider value={open}>{children}</LargeContentViewerContext.Provider>
  );
}

export function LargeContentViewerSession({
  initialRequest,
  onClose,
}: {
  initialRequest: LargeContentViewerRequest;
  onClose(): void;
}) {
  const resourceNamespace = useId();
  const [selection, setSelection] = useState({ request: initialRequest, offset: 0 });
  const resourceRevision = `${selection.request.reference.id}:${selection.request.reference.contentType}:${selection.offset}`;
  const content = useEphemeralAsyncResource<PrivateAssetTextResult>(
    `large-content:${resourceNamespace}`,
    resourceRevision,
    async (_publish, signal) =>
      await readPrivateAssetText(
        { kind: "content", id: selection.request.reference.id },
        selection.request.getTransferAccess,
        {
          offset: selection.offset,
          limit: CONTENT_VIEW_CHUNK_BYTES,
          accept: selection.request.reference.contentType,
          signal,
        },
      ),
  );
  const selected: LargeContentViewerSelection = {
    ...selection.request,
    offset: selection.offset,
    nextOffset: content.value?.nextOffset ?? selection.offset,
    text: content.value?.text ?? null,
    loading: content.status === "idle" || content.status === "loading",
    error: content.error,
  };
  const load = (request: LargeContentViewerRequest, offset: number) => {
    setSelection({ request, offset });
  };
  const request = {
    pointer: selected.pointer,
    reference: selected.reference,
    presentation: selected.presentation,
    getTransferAccess: selected.getTransferAccess,
  };
  return (
    <FullContentViewer
      selection={selected}
      onClose={onClose}
      onPrevious={() => void load(request, Math.max(0, selected.offset - CONTENT_VIEW_CHUNK_BYTES))}
      onNext={() => void load(request, selected.nextOffset)}
    />
  );
}

export function LargeContentControls({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
}) {
  const open = useContext(LargeContentViewerContext);
  const references = (() => {
    if (block.content === null) return [];
    const entries = Object.entries(block.content.fields);
    if (block.content.whole !== null) entries.push(["/", block.content.whole]);
    return entries;
  })();
  if (references.length === 0) return null;
  return (
    <View style={styles.largeContentControl}>
      <View style={styles.largeContentActions}>
        {references.slice(0, 8).map(([pointer, reference], index) => (
          <Pressable
            key={`${pointer}:${reference.id}`}
            accessibilityRole="button"
            disabled={getTransferAccess === undefined || open === null}
            onPress={() => {
              if (getTransferAccess !== undefined)
                open?.({
                  pointer,
                  reference,
                  presentation: largeContentPresentation(pointer, reference),
                  getTransferAccess,
                });
            }}
            style={({ pressed }) => [styles.largeContentButton, pressed && styles.pressed]}
          >
            <InlineIcon name="document-text-outline" role="label" color={colors.textMuted} />
            <Text numberOfLines={1} style={styles.largeContentButtonText}>
              {references.length === 1
                ? "Open full content"
                : `Open ${contentPointerLabel(pointer, index)}`}
            </Text>
            <Text style={styles.turnMetaText}>{formatContentBytes(reference.byteLength)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function largeContentPresentation(
  pointer: string,
  reference: RenderContentReference,
): LargeContentViewerRequest["presentation"] {
  if (reference.contentType.startsWith("text/markdown")) return "markdown";
  if (
    reference.contentType.startsWith("text/x-ansi") ||
    pointer === "/aggregatedOutput" ||
    pointer.endsWith("/aggregatedOutput")
  )
    return "terminal";
  return "text";
}

export function FullContentViewer({
  selection,
  onClose,
  onPrevious,
  onNext,
}: FullContentViewerProps) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const title =
    selection.pointer === "/" ? "Full output" : contentPointerLabel(selection.pointer, 0);
  const hasPrevious = selection.offset > 0;
  const hasNext =
    selection.nextOffset > selection.offset &&
    selection.nextOffset < selection.reference.byteLength;
  const rangeEnd = Math.max(selection.offset, selection.nextOffset);
  return renderFullContentViewerBody({
    selection,
    onClose,
    onPrevious,
    onNext,
    viewportHeight,
    setViewportHeight,
    title,
    hasPrevious,
    hasNext,
    rangeEnd,
    formatContentBytes,
  });
}

export function contentPointerLabel(pointer: string, index: number): string {
  const segment = pointer.split("/").filter(Boolean).at(-1);
  return segment === undefined
    ? `content ${index + 1}`
    : segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function formatContentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

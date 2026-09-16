import type { FullContentViewerProps } from "./FullContentViewer.types";
import { renderFullContentViewerBody } from "./FullContentViewerBody";
/** V1 FullContentViewer owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock, RenderContentReference } from "@codewide/renderers";
import { useContext, useId, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { readPrivateAssetText, type PrivateAssetTextResult } from "../../../data/private-transfer";
import { useEvent } from "../../../react/useEvent";
import { useEphemeralAsyncResource } from "../../../rendering/async-resource-store";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { CONTENT_VIEW_CHUNK_BYTES } from "./contentLimits";
import { LargeContentViewerContext, type LargeContentViewerRequest } from "./contentViewerContext";
import { styles } from "./FullContentViewer.styles";
import { useConversationRouteNavigation } from "../conversationRouteNavigation";

export async function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export type LargeContentViewerSelection = LargeContentViewerRequest & {
  error: string | null;
  loading: boolean;
  nextOffset: number;
  offset: number;
  text: string | null;
};

export function LargeContentViewerHost({ children }: { children: ReactNode }) {
  const navigation = useConversationRouteNavigation();
  const open = useEvent((request: LargeContentViewerRequest) => {
    navigation.openContent(request);
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
  onClose: () => void;
}) {
  const resourceNamespace = useId();
  const [selection, setSelection] = useState({ offset: 0, request: initialRequest });
  const resourceRevision = `${selection.request.reference.id}:${selection.request.reference.contentType}:${String(selection.offset)}`;
  const content = useEphemeralAsyncResource<PrivateAssetTextResult>(
    `large-content:${resourceNamespace}`,
    resourceRevision,
    async (_publish, signal) =>
      readPrivateAssetText(
        { id: selection.request.reference.id, kind: "content" },
        selection.request.getTransferAccess,
        {
          accept: selection.request.reference.contentType,
          limit: CONTENT_VIEW_CHUNK_BYTES,
          offset: selection.offset,
          signal,
        },
      ),
  );
  const selected: LargeContentViewerSelection = {
    ...selection.request,
    error: content.error,
    loading: content.status === "idle" || content.status === "loading",
    nextOffset: content.value?.nextOffset ?? selection.offset,
    offset: selection.offset,
    text: content.value?.text ?? null,
  };
  const load = (request: LargeContentViewerRequest, offset: number) => {
    setSelection({ offset, request });
  };
  const request = {
    getTransferAccess: selected.getTransferAccess,
    pointer: selected.pointer,
    presentation: selected.presentation,
    reference: selected.reference,
  };
  return (
    <FullContentViewer
      onClose={onClose}
      onNext={() => {
        load(request, selected.nextOffset);
      }}
      onPrevious={() => {
        load(request, Math.max(0, selected.offset - CONTENT_VIEW_CHUNK_BYTES));
      }}
      selection={selected}
    />
  );
}

export function LargeContentControls({
  block,
  getTransferAccess,
}: {
  block: RenderBlock;
  getTransferAccess?: (
    forceRefresh?: boolean,
  ) => Promise<{ authorization: string; baseUrl: string }>;
}) {
  const open = useContext(LargeContentViewerContext);
  const references = (() => {
    if (block.content === null) {
      return [];
    }
    const entries = Object.entries(block.content.fields);
    if (block.content.whole !== null) {
      entries.push(["/", block.content.whole]);
    }
    return entries;
  })();
  if (references.length === 0) {
    return null;
  }
  return (
    <View style={styles.largeContentControl}>
      <View style={styles.largeContentActions}>
        {references.slice(0, 8).map(([pointer, reference], index) => (
          <Pressable
            accessibilityRole="button"
            disabled={getTransferAccess === undefined || open === null}
            key={`${pointer}:${reference.id}`}
            onPress={() => {
              if (getTransferAccess !== undefined) {
                open?.({
                  getTransferAccess,
                  pointer,
                  presentation: largeContentPresentation(pointer, reference),
                  reference,
                });
              }
            }}
            style={({ pressed }) => [styles.largeContentButton, pressed && styles.pressed]}
          >
            <InlineIcon color={colors.textMuted} name="document-text-outline" role="label" />
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
  if (reference.contentType.startsWith("text/markdown")) {
    return "markdown";
  }
  if (
    reference.contentType.startsWith("text/x-ansi") ||
    pointer === "/aggregatedOutput" ||
    pointer.endsWith("/aggregatedOutput")
  ) {
    return "terminal";
  }
  return "text";
}

export function FullContentViewer({
  onClose,
  onNext,
  onPrevious,
  selection,
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
    formatContentBytes,
    hasNext,
    hasPrevious,
    onClose,
    onNext,
    onPrevious,
    rangeEnd,
    selection,
    setViewportHeight,
    title,
    viewportHeight,
  });
}

export function contentPointerLabel(pointer: string, index: number): string {
  const segment = pointer.split("/").filter(Boolean).at(-1);
  return segment === undefined
    ? `content ${String(index + 1)}`
    : segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function formatContentBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${String(Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

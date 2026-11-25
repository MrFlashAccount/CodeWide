/** V1 AgentResponseMarkdown owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { projectMarkdownStream } from "@codewide/rendering-core";
import { ActivityIndicator, View } from "react-native";
import { readPrivateAssetText, type TransferAccess } from "../../../data/private-transfer";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import { CompleteMarkdownDocument } from "../../../rendering/CompleteMarkdown";
import { prepareCompleteMarkdown } from "../../../rendering/prepareCompleteMarkdown";
import { completeMarkdownStyles } from "../../../rendering/CompleteMarkdown.styles";
import type { ContentReviewTarget } from "../../../rendering/content-review";
import { ContentReviewComments } from "../../../rendering/ContentReviewHost";
import { occurrenceKey, textFingerprint } from "../../../rendering/listKey";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import {
  completeMarkdownLayout,
  richMarkdownLayout,
} from "../../../rendering/rich-markdown-layout";
import { SearchMessage } from "../../../rendering/SearchMessageFocus";
import { usePrivateFileAccessScope } from "../../../rendering/use-private-image-uri";
import { colors } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./AgentResponseMarkdown.styles";
import { CONTENT_VIEW_CHUNK_BYTES } from "./contentLimits";
import { nextRenderFrame } from "./FullContentViewer";

export function AgentResponseMarkdown({
  block,
  getTransferAccess,
  onVisibilityLayout,
  visibilityRef,
}: {
  block: RenderBlock;
  getTransferAccess?: (forceRefresh?: boolean) => Promise<TransferAccess>;
  onVisibilityLayout?: () => void;
  visibilityRef?: (node: View | null) => void;
}) {
  const resourceScope = usePrivateFileAccessScope();
  const reviewTarget: ContentReviewTarget = {
    id: `agent-response:${block.key}`,
    label: "Completed agent response",
    reference: block.key,
  };
  const reference = block.content?.fields["/text"] ?? null;
  const resourceKey =
    reference === null || getTransferAccess === undefined
      ? null
      : `complete-markdown:${resourceScope}:${reference.id}:${String(reference.byteLength)}`;
  const resource = useAsyncResource<string[]>(
    resourceKey,
    resourceKey ?? "none",
    async (publish, signal) => {
      if (reference === null || getTransferAccess === undefined) {
        return [];
      }
      let offset = 0;
      let remainder = "";
      let segments: string[] = [];
      while (!signal.aborted && offset < reference.byteLength) {
        const loaded = await readPrivateAssetText(
          { id: reference.id, kind: "content" },
          getTransferAccess,
          {
            accept: reference.contentType,
            limit: CONTENT_VIEW_CHUNK_BYTES,
            offset,
            signal,
          },
        );
        const body = loaded.text;
        const nextOffset = loaded.nextOffset;
        if (nextOffset <= offset) {
          throw new Error("Complete response returned an invalid range");
        }
        const projected = projectMarkdownStream(
          remainder,
          body,
          nextOffset >= reference.byteLength,
        );
        remainder = projected.remainder;
        // WHY: The AbortSignal can change while the awaited content range and render frame are pending.
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (projected.segments.length > 0 && !signal.aborted) {
          segments = [...segments, ...projected.segments];
          publish(segments);
          await nextRenderFrame();
        }
        offset = nextOffset;
      }
      if (!signal.aborted && remainder.length > 0) {
        const projected = projectMarkdownStream(remainder, "", true);
        if (projected.segments.length > 0) {
          segments = [...segments, ...projected.segments];
        }
      }
      return segments;
    },
    markdownSegmentsWeight,
  );
  const segments = resource.value ?? [];
  const body = block.body ?? "";
  const loading = resource.status === "loading";
  const error = resource.error;
  let fill: boolean;
  let content: React.JSX.Element;
  if (reference === null || segments.length === 0) {
    const document = prepareCompleteMarkdown(body);
    fill = document.fill;
    content = (
      <SearchMessage itemId={block.raw.id}>
        <CompleteMarkdownDocument document={document} reviewTarget={reviewTarget} />
      </SearchMessage>
    );
  } else {
    fill =
      segments.some((segment) => richMarkdownLayout(segment) === "fill") ||
      completeMarkdownLayout(body) === "fill";
    const segmentOccurrences = new Map<string, number>();
    content = (
      <>
        {segments.map((segment, index) => (
          <RichMarkdown
            key={occurrenceKey(segmentOccurrences, `${reference.id}:${textFingerprint(segment)}`)}
            reviewPathPrefix={`segment-${String(index)}`}
            reviewTarget={reviewTarget}
            source={segment}
          />
        ))}
        <ContentReviewComments targetId={reviewTarget.id} />
      </>
    );
  }
  return (
    <View
      onLayout={onVisibilityLayout}
      ref={visibilityRef}
      style={[completeMarkdownStyles.document, fill && completeMarkdownStyles.documentFill]}
    >
      {content}
      {loading && (
        <ActivityIndicator
          accessibilityLabel="Loading complete response"
          color={colors.textMuted}
          size="small"
        />
      )}
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

function markdownSegmentsWeight(segments: string[]): number {
  return segments.reduce((bytes, segment) => bytes + segment.length * 2, 0);
}

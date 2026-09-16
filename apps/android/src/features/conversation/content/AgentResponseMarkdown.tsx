/** V1 AgentResponseMarkdown owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { projectCompleteMarkdown, projectMarkdownStream } from "@codewide/rendering-core";
import { Fragment } from "react";
import { ActivityIndicator, View } from "react-native";
import { readPrivateAssetText } from "../../../data/private-transfer";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import type { ContentReviewTarget } from "../../../rendering/content-review";
import { ContentReviewComments } from "../../../rendering/ContentReviewHost";
import { richMarkdownLayout } from "../../../rendering/rich-markdown-layout";
import { occurrenceKey, textFingerprint } from "../../../rendering/listKey";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { SearchMessage } from "../../../rendering/SearchMessageFocus";
import { StreamingRevealSurface } from "../../../rendering/StreamingRevealSurface";
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
  getTransferAccess?: (
    forceRefresh?: boolean,
  ) => Promise<{ authorization: string; baseUrl: string }>;
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
  const loading = resource.status === "loading";
  const error = resource.error;
  const fill =
    richMarkdownLayout(block.body ?? "") === "fill" ||
    segments.some((segment) => richMarkdownLayout(segment) === "fill");
  const documentStyle = [styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill];
  const segmentOccurrences = new Map<string, number>();

  if (reference === null || segments.length === 0) {
    return (
      <View onLayout={onVisibilityLayout} ref={visibilityRef} style={documentStyle}>
        <SearchMessage itemId={block.raw.id}>
          <CompleteAgentMarkdown reviewTarget={reviewTarget} source={block.body ?? ""} />
        </SearchMessage>
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
  return (
    <View onLayout={onVisibilityLayout} ref={visibilityRef} style={documentStyle}>
      {segments.map((segment, index) => {
        const key = occurrenceKey(
          segmentOccurrences,
          `${reference.id}:${textFingerprint(segment)}`,
        );
        return (
          <RichMarkdown
            key={key}
            reviewPathPrefix={`segment-${String(index)}`}
            reviewTarget={reviewTarget}
            source={segment}
          />
        );
      })}
      <ContentReviewComments targetId={reviewTarget.id} />
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

export function markdownSegmentsWeight(segments: string[]): number {
  return segments.reduce((bytes, segment) => bytes + segment.length * 2, 0);
}

export function CompleteAgentMarkdown({
  reviewTarget,
  source,
  streamKey,
}: {
  reviewTarget?: ContentReviewTarget;
  source: string;
  streamKey?: string;
}) {
  const segments = projectCompleteMarkdown(source);
  const fill = richMarkdownLayout(source) === "fill";
  const segmentOccurrences = new Map<string, number>();
  return (
    <View style={[styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill]}>
      {segments.map((segment, index) => {
        const key = occurrenceKey(segmentOccurrences, textFingerprint(segment));
        const content = (
          <RichMarkdown
            source={segment}
            {...(reviewTarget === undefined
              ? {}
              : { reviewPathPrefix: `segment-${String(index)}`, reviewTarget })}
          />
        );
        return streamKey === undefined ? (
          <Fragment key={key}>{content}</Fragment>
        ) : (
          <StreamingRevealSurface
            animateNew={false}
            key={key}
            streamKey={index === 0 ? streamKey : `${streamKey}:${String(index)}`}
          >
            {content}
          </StreamingRevealSurface>
        );
      })}
      {reviewTarget !== undefined && <ContentReviewComments targetId={reviewTarget.id} />}
    </View>
  );
}

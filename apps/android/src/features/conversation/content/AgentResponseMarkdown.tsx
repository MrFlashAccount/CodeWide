/** V1 AgentResponseMarkdown owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
import { projectCompleteMarkdown, projectMarkdownStream } from "@codewide/rendering-core";
import { Fragment } from "react";
import { ActivityIndicator, View } from "react-native";
import { readPrivateAssetText } from "../../../data/private-transfer";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import type { ContentReviewTarget } from "../../../rendering/content-review";
import { ContentReviewComments } from "../../../rendering/ContentReviewHost";
import { richMarkdownLayout } from "../../../rendering/rich-markdown-layout";
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
  visibilityRef,
  onVisibilityLayout,
}: {
  block: RenderBlock;
  getTransferAccess?(forceRefresh?: boolean): Promise<{ baseUrl: string; authorization: string }>;
  visibilityRef?(node: View | null): void;
  onVisibilityLayout?(): void;
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
      : `complete-markdown:${resourceScope}:${reference.id}:${reference.byteLength}`;
  const resource = useAsyncResource<string[]>(
    resourceKey,
    resourceKey ?? "none",
    async (publish, signal) => {
      if (reference === null || getTransferAccess === undefined) return [];
      let offset = 0;
      let remainder = "";
      let segments: string[] = [];
      while (!signal.aborted && offset < reference.byteLength) {
        const loaded = await readPrivateAssetText(
          { kind: "content", id: reference.id },
          getTransferAccess,
          {
            offset,
            limit: CONTENT_VIEW_CHUNK_BYTES,
            accept: reference.contentType,
            signal,
          },
        );
        const body = loaded.text;
        const nextOffset = loaded.nextOffset;
        if (nextOffset <= offset) throw new Error("Complete response returned an invalid range");
        const projected = projectMarkdownStream(
          remainder,
          body,
          nextOffset >= reference.byteLength,
        );
        remainder = projected.remainder;
        if (projected.segments.length > 0 && !signal.aborted) {
          segments = [...segments, ...projected.segments];
          publish(segments);
          await nextRenderFrame();
        }
        offset = nextOffset;
      }
      if (!signal.aborted && remainder.length > 0) {
        const projected = projectMarkdownStream(remainder, "", true);
        if (projected.segments.length > 0) segments = [...segments, ...projected.segments];
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

  if (reference === null || segments.length === 0) {
    return (
      <View ref={visibilityRef} onLayout={onVisibilityLayout} style={documentStyle}>
        <SearchMessage itemId={block.raw.id}>
          <CompleteAgentMarkdown source={block.body ?? ""} reviewTarget={reviewTarget} />
        </SearchMessage>
        {loading && (
          <ActivityIndicator
            accessibilityLabel="Loading complete response"
            size="small"
            color={colors.textMuted}
          />
        )}
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }
  return (
    <View ref={visibilityRef} onLayout={onVisibilityLayout} style={documentStyle}>
      {segments.map((segment, index) => (
        <RichMarkdown
          key={`${reference.id}:${index}`}
          source={segment}
          reviewTarget={reviewTarget}
          reviewPathPrefix={`segment-${index}`}
        />
      ))}
      <ContentReviewComments targetId={reviewTarget.id} />
      {loading && (
        <ActivityIndicator
          accessibilityLabel="Loading complete response"
          size="small"
          color={colors.textMuted}
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
  source,
  reviewTarget,
  streamKey,
}: {
  source: string;
  reviewTarget?: ContentReviewTarget;
  streamKey?: string;
}) {
  const segments = projectCompleteMarkdown(source);
  const fill = richMarkdownLayout(source) === "fill";
  return (
    <View style={[styles.agentMarkdownDocument, fill && styles.agentMarkdownDocumentFill]}>
      {segments.map((segment, index) => {
        const content = (
          <RichMarkdown
            source={segment}
            {...(reviewTarget === undefined
              ? {}
              : { reviewTarget, reviewPathPrefix: `segment-${index}` })}
          />
        );
        return streamKey === undefined ? (
          <Fragment key={index}>{content}</Fragment>
        ) : (
          <StreamingRevealSurface
            key={index}
            streamKey={index === 0 ? streamKey : `${streamKey}:${index}`}
            animateNew={false}
          >
            {content}
          </StreamingRevealSurface>
        );
      })}
      {reviewTarget !== undefined && <ContentReviewComments targetId={reviewTarget.id} />}
    </View>
  );
}

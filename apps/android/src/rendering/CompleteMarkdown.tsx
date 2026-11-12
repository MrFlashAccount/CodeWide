import { projectCompleteMarkdown } from "@codewide/rendering-core";
import { Fragment } from "react";
import { View } from "react-native";

import type { ContentReviewTarget } from "./content-review";
import { ContentReviewComments } from "./ContentReviewHost";
import { completeMarkdownStyles as styles } from "./CompleteMarkdown.styles";
import { occurrenceKey, textFingerprint } from "./listKey";
import { RichMarkdown } from "./RichMarkdown";
import { richMarkdownLayout } from "./rich-markdown-layout";
import { StreamingRevealSurface } from "./StreamingRevealSurface";

/**
 * Renders a settled Markdown document through the same segmentation, geometry,
 * rich-node and review pipeline used by completed conversation responses.
 */
export function CompleteMarkdown({
  reviewTarget,
  source,
  streamKey,
}: {
  readonly reviewTarget?: ContentReviewTarget;
  readonly source: string;
  readonly streamKey?: string;
}): React.JSX.Element {
  const segments = projectCompleteMarkdown(source);
  const fill = richMarkdownLayout(source) === "fill";
  const segmentOccurrences = new Map<string, number>();
  return (
    <View style={[styles.document, fill && styles.documentFill]}>
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

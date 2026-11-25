import { Fragment } from "react";
import { View } from "react-native";

import type { ContentReviewTarget } from "./content-review";
import { ContentReviewComments } from "./ContentReviewHost";
import { completeMarkdownStyles as styles } from "./CompleteMarkdown.styles";
import { prepareCompleteMarkdown, type PreparedDocument } from "./prepareCompleteMarkdown";
import { occurrenceKey, textFingerprint } from "./listKey";
import { RichMarkdown } from "./RichMarkdown";
import { StreamingRevealSurface } from "./StreamingRevealSurface";

type DocumentOptions = {
  readonly reviewTarget?: ContentReviewTarget;
  readonly streamKey?: string;
};

/** Presents a settled Markdown source with the document and review conventions used by chat. */
export function CompleteMarkdown({
  source,
  ...options
}: DocumentOptions & { readonly source: string }): React.JSX.Element {
  return <CompleteMarkdownDocument {...options} document={prepareCompleteMarkdown(source)} />;
}

/** Renders the same document that the enclosing surface used to select its width. */
export function CompleteMarkdownDocument({
  document,
  reviewTarget,
  streamKey,
}: DocumentOptions & { readonly document: PreparedDocument }): React.JSX.Element {
  const segmentOccurrences = new Map<string, number>();
  return (
    <View style={[styles.document, document.fill && styles.documentFill]}>
      {document.segments.map((segment, index) => {
        const key = occurrenceKey(segmentOccurrences, textFingerprint(segment.source));
        const content = (
          <RichMarkdown
            segment={segment}
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

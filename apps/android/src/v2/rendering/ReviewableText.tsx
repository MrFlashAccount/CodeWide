import type { ComponentProps } from "react";
import { StyleSheet, type GestureResponderEvent } from "react-native";

import { useEvent } from "../../react/useEvent";
import { PresentationText } from "../presentation/text/ProductText";
import { useV2RenderingCapabilities } from "./renderingCapabilities";

interface ReviewableTextProps extends ComponentProps<typeof PresentationText> {
  reviewBlockPath?: string;
  reviewOffset?: number;
  reviewTargetId?: string;
  reviewValue?: string;
}

/**
 * V2 review anchor boundary. Native selection can replace the whole-block
 * fallback without changing the transport-neutral review contract.
 */
export function ReviewableText(props: ReviewableTextProps): React.JSX.Element {
  const {
    onLongPress,
    reviewBlockPath,
    reviewOffset = 0,
    reviewTargetId,
    reviewValue,
    style,
    ...textProps
  } = props;
  const capabilities = useV2RenderingCapabilities();
  const beginReview = useEvent((event: GestureResponderEvent) => {
    onLongPress?.(event);
    if (
      capabilities.beginReview === undefined ||
      reviewBlockPath === undefined ||
      reviewTargetId === undefined ||
      reviewValue === undefined ||
      reviewValue === ""
    )
      return;
    const result = capabilities.beginReview({
      blockPath: reviewBlockPath,
      end: reviewOffset + reviewValue.length,
      kind: "text",
      quote: reviewValue,
      start: reviewOffset,
      targetId: reviewTargetId,
    });
    void Promise.resolve(result).catch(() => undefined);
  });
  const canReview =
    capabilities.beginReview !== undefined &&
    reviewBlockPath !== undefined &&
    reviewTargetId !== undefined &&
    reviewValue !== undefined &&
    reviewValue !== "";
  return (
    <PresentationText
      {...textProps}
      onLongPress={canReview || onLongPress !== undefined ? beginReview : undefined}
      selectable
      style={[style, canReview ? styles.reviewable : null]}
    />
  );
}

const styles = StyleSheet.create({
  reviewable: { textDecorationColor: "transparent", textDecorationLine: "underline" },
});

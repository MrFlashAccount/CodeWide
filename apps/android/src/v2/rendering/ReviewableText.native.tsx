import { useId, type ComponentProps } from "react";
import { StyleSheet, Text as NativeText, View, type StyleProp, type TextStyle } from "react-native";

import { useContentReviewSelectionBinding } from "../infrastructure/react/useContentReviewSelectionBinding";
import { AsyncActionFeedbackView } from "../presentation/actions/AsyncActionFeedbackView";
import { productFonts } from "../ui/productFonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typographyPolicy";
import { typeWeight } from "../theme";
import { useV2RenderingCapabilities } from "./renderingCapabilities";
import { useReviewSelectionAction } from "./review/useReviewSelectionAction";

interface ReviewableTextProps extends ComponentProps<typeof NativeText> {
  reviewBlockPath?: string;
  reviewOffset?: number;
  reviewTargetId?: string;
  reviewValue?: string;
}

export function ReviewableText(props: ReviewableTextProps): React.JSX.Element {
  const {
    allowFontScaling = true,
    maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
    reviewBlockPath,
    reviewOffset = 0,
    reviewTargetId,
    reviewValue,
    style,
    ...textProps
  } = props;
  const capabilities = useV2RenderingCapabilities();
  const generatedId = useId();
  const token = `v2-review-text-${generatedId}`;
  const canReview =
    capabilities.beginReview !== undefined &&
    reviewBlockPath !== undefined &&
    reviewTargetId !== undefined &&
    reviewValue !== undefined &&
    reviewValue !== "";
  const action = useReviewSelectionAction({
    beginReview: capabilities.beginReview,
    blockPath: reviewBlockPath,
    offset: reviewOffset,
    targetId: reviewTargetId,
  });
  const textRef = useContentReviewSelectionBinding({
    enabled: canReview,
    onSelection: action.activate,
    token,
  });

  return (
    <View style={styles.root}>
      <NativeText
        ref={textRef}
        {...textProps}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        selectable
        style={[style, presentationFontStyle(style)]}
      />
      <AsyncActionFeedbackView
        error={action.action.error}
        onRetry={action.action.retry}
        pending={action.action.pending}
        pendingLabel={action.action.pendingLabel}
      />
    </View>
  );
}

function presentationFontStyle(style: StyleProp<TextStyle>): TextStyle | null {
  const flattened = StyleSheet.flatten(style);
  if (flattened?.fontFamily !== undefined) return null;
  const rawWeight = flattened?.fontWeight;
  const weight = rawWeight === "bold" ? 700 : Number.parseInt(String(rawWeight ?? 400), 10);
  const fontFamily =
    weight <= 400
      ? productFonts.regular
      : weight <= 500
        ? productFonts.medium
        : productFonts.semibold;
  return { fontFamily, fontWeight: typeWeight.regular };
}

const styles = StyleSheet.create({
  root: { alignSelf: "stretch", minWidth: 0 },
});

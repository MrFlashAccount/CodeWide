import type { ComponentProps } from "react";
import { Text as NativeText } from "react-native";

import { AppText } from "../ui/Typography";
import type { ReviewSelection } from "./ReviewableText.native";

export function ReviewableText({
  onReviewSelection: _onReviewSelection,
  reviewHighlights: _reviewHighlights,
  ...props
}: ComponentProps<typeof NativeText> & {
  onReviewSelection(selection: ReviewSelection): void;
  reviewHighlights?: readonly { start: number; end: number }[];
}) {
  return <AppText {...props} selectable />;
}

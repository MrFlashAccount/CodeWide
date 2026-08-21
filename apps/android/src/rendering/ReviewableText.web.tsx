import type { ComponentProps } from "react";
import { Text as NativeText } from "react-native";

import { AppText } from "../ui/Typography";
import type { ReviewSelection } from "./ReviewableText.native";

export function ReviewableText({
  onReviewSelection: _onReviewSelection,
  ...props
}: ComponentProps<typeof NativeText> & {
  onReviewSelection(selection: ReviewSelection): void;
}) {
  return <AppText {...props} selectable />;
}

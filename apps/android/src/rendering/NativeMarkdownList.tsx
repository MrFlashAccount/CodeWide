import { useContext, useState, type ReactElement } from "react";
import { useWindowDimensions, type NativeSyntheticEvent } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";
import type { ContentReviewTarget } from "./content-review";
import { ContentReviewTextFallback, useContentReview } from "./ContentReviewHost";
import type { ChatMarkdownBlock } from "./markdownListGroups";
import {
  MarkdownListHost as Host,
  useListScreenReader,
  type ListSelection,
} from "./nativeMarkdownListHost";
import { richMarkdownGeometry } from "./richMarkdownGeometry";
import { SearchHighlightQuery } from "./SearchMessageFocus";

type Group = NonNullable<ChatMarkdownBlock["listGroup"]>;
const HEIGHT_TOLERANCE_DP = 0.5;

type GroupProps = { group: Group; target: ContentReviewTarget | undefined };

/** Retains the rich renderer for paragraph highlights or a search match. */
export function NativeMarkdownList({
  children,
  group,
  target,
}: GroupProps & { children: ReactElement }): ReactElement {
  const search = useContext(SearchHighlightQuery);
  const screenReader = useListScreenReader();
  if (search !== "" || screenReader || Host === null) {
    return children;
  }
  return (
    <ContentReviewTextFallback fallback={children} paragraphs={group.lines} targetId={target?.id}>
      <ListText group={group} target={target} />
    </ContentReviewTextFallback>
  );
}

function ListText({ group, target }: GroupProps) {
  const begin = useContentReview();
  const [measured, setMeasured] = useState<number | null>(null);
  const scale = Math.min(useWindowDimensions().fontScale, APP_MAX_FONT_SIZE_MULTIPLIER);
  const lineHeight = typeScale.body.lineHeight * scale;
  const content = {
    checkedColor: colors.green,
    font: productFonts.regular,
    fontSize: typeScale.body.fontSize * scale,
    gap: richMarkdownGeometry.listGap,
    iconSize: iconSize.inline,
    inset: richMarkdownGeometry.listInset,
    lineHeight,
    lines: group.lines,
    markerColor: colors.textMuted,
    markerGap: richMarkdownGeometry.listRowGap,
    nestedGap: richMarkdownGeometry.listBodyGap,
    review: target !== undefined,
    textColor: colors.text,
  };
  const estimate = group.lines.reduce(
    (sum, line, index) =>
      sum +
      lineHeight +
      (index === group.lines.length - 1
        ? 0
        : line.followedByChildren
          ? content.nestedGap
          : content.gap),
    0,
  );
  const select = useEvent(
    ({ nativeEvent: { end, index, start } }: NativeSyntheticEvent<ListSelection>) => {
      const line = group.lines[index];
      if (
        target === undefined ||
        line === undefined ||
        start < 0 ||
        end > line.body.length ||
        start >= end
      ) {
        return;
      }
      begin({
        blockPath: line.path,
        end,
        kind: "text",
        quote: line.body.slice(start, end),
        start,
        target,
      });
    },
  );
  const resize = useEvent(
    ({ nativeEvent: { height } }: NativeSyntheticEvent<{ height: number }>) => {
      if (height > 0) {
        setMeasured(Math.abs(height - estimate) < HEIGHT_TOLERANCE_DP ? null : height);
      }
    },
  );
  return Host === null ? null : (
    <Host
      content={content}
      onListHeight={resize}
      onListSelection={select}
      style={{ alignSelf: "stretch", height: measured ?? estimate }}
    />
  );
}

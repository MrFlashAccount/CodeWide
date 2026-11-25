import type { ComponentProps } from "react";
import { Text } from "react-native";
import type { RichMarkdown as ProductionRichMarkdown } from "../../src/rendering/RichMarkdown";

export function richMarkdownLayout(source: string): "fill" | "intrinsic" {
  return source.includes("```") || /\n\s*\|?\s*:?-{3,}:?\s*\|/u.test(source) ? "fill" : "intrinsic";
}

export function RichMarkdown(props: ComponentProps<typeof ProductionRichMarkdown>): React.JSX.Element {
  const { maxLines } = props;
  const source = props.segment === undefined ? props.source : props.segment.source;
  return <Text {...(maxLines === undefined ? {} : { numberOfLines: maxLines })}>{source}</Text>;
}

export function RichMarkdownDocumentBlockView(): React.JSX.Element {
  return <Text>Rendered Markdown block</Text>;
}

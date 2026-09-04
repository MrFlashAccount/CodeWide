import { Text } from "react-native";

interface RichMarkdownProps {
  maxLines?: number;
  source: string;
}

export function richMarkdownLayout(source: string): "fill" | "intrinsic" {
  return source.includes("```") || /\n\s*\|?\s*:?-{3,}:?\s*\|/u.test(source) ? "fill" : "intrinsic";
}

export function RichMarkdown(props: RichMarkdownProps): React.JSX.Element {
  const { maxLines, source } = props;
  return <Text {...(maxLines === undefined ? {} : { numberOfLines: maxLines })}>{source}</Text>;
}

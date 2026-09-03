import { Text } from "react-native";

interface RichMarkdownProps {
  maxLines?: number;
  source: string;
}

export function RichMarkdown(props: RichMarkdownProps): React.JSX.Element {
  const { maxLines, source } = props;
  return <Text {...(maxLines === undefined ? {} : { numberOfLines: maxLines })}>{source}</Text>;
}

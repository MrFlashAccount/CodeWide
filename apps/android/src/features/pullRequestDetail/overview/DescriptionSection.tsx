import { View } from "react-native";

import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { AppText as Text } from "../../../ui/Typography";
import { overviewStyles as styles } from "./overview.styles";

/** PR description through the same safe rich Markdown renderer as conversation bubbles. */
export function DescriptionSection({
  description,
}: {
  readonly description: string;
}): React.JSX.Element | null {
  if (description.trim().length === 0) {
    return null;
  }
  return (
    <View style={styles.card} testID="pull-request-description">
      <View style={styles.cardHeader}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Description
        </Text>
      </View>
      <View style={[styles.cardLine, styles.markdownLine]}>
        <RichMarkdown source={description} />
      </View>
    </View>
  );
}

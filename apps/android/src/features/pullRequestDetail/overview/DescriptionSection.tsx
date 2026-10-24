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
    <View style={styles.section} testID="pull-request-description">
      <Text accessibilityRole="header" style={styles.sectionHeader}>
        Description
      </Text>
      <View style={[styles.sectionBody, styles.markdownLine]}>
        <RichMarkdown source={description} />
      </View>
    </View>
  );
}

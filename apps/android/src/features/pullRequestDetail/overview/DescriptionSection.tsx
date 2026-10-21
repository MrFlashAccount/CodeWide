import { View } from "react-native";

import { AppText as Text } from "../../../ui/Typography";
import { overviewStyles as styles } from "./overview.styles";

/** PR description as plain selectable text: it is untrusted forge Markdown and is never executed as markup. */
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
      <View style={styles.cardLine}>
        <Text selectable style={styles.body}>
          {description}
        </Text>
      </View>
    </View>
  );
}

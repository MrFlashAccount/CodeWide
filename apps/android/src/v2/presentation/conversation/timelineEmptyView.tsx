import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

export function TimelineEmptyView(): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <PresentationIcon color={colors.textDim} name="sparkles" size={26} />
      <ProductText style={styles.title} weight="semibold">
        Start by typing a message
      </ProductText>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", flex: 1, gap: spacing.sm, justifyContent: "center" },
  title: { ...typeScale.title },
});

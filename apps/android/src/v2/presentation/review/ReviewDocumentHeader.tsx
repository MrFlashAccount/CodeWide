import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";

interface ReviewDocumentHeaderProps {
  onBack(): void;
  path: string;
  showBack: boolean;
}

export function ReviewDocumentHeader(props: ReviewDocumentHeaderProps): React.JSX.Element {
  const { onBack, path, showBack } = props;
  return (
    <View style={styles.root}>
      {showBack ? (
        <Pressable
          accessibilityLabel="Back to review files"
          onPress={onBack}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="arrow-back" size={20} />
        </Pressable>
      ) : null}
      <View style={styles.copy}>
        <ProductText ellipsizeMode="middle" numberOfLines={1} weight="medium">
          {path}
        </ProductText>
        <ProductText style={styles.subtitle} tone="dim">
          Tap a source line to comment
        </ProductText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  root: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  subtitle: { ...typeScale.caption },
});

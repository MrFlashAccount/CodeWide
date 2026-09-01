import { ActivityIndicator, StyleSheet, View } from "react-native";

import { colors, spacing } from "../../theme";
import { ActionButtonView } from "../actions/ActionButtonView";
import { ProductText } from "../text/ProductText";

interface ResourceStateViewProps {
  message: string;
  onRetry?(): void;
  status: "error" | "loading";
}

export function ResourceStateView({
  message,
  onRetry,
  status,
}: ResourceStateViewProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      {status === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
      <ProductText
        accessibilityLiveRegion="polite"
        style={styles.message}
        tone={status === "error" ? "danger" : "muted"}
      >
        {message}
      </ProductText>
      {status === "error" && onRetry !== undefined ? (
        <ActionButtonView disabled={false} label="Try again" onPress={onRetry} pending={false} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { maxWidth: 360, textAlign: "center" },
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
});

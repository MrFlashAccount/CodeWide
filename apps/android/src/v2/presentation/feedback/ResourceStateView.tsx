import { StyleSheet, View } from "react-native";

import { colors, spacing } from "../../theme";
import { ActionButtonView } from "../actions/ActionButtonView";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface ResourceStateViewProps {
  message: string;
  onRetry?(): void;
  status: "error" | "loading";
}

export function ResourceStateView(props: ResourceStateViewProps): React.JSX.Element {
  const { message, onRetry, status } = props;
  return (
    <View style={styles.root}>
      {status === "loading" ? (
        <ShimmerText style={styles.message} text={message} />
      ) : (
        <ProductText accessibilityLiveRegion="polite" style={styles.message} tone="danger">
          {message}
        </ProductText>
      )}
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

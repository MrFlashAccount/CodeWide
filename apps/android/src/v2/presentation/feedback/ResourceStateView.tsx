import { useTransition } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing } from "../../theme";
import { ActionButtonView } from "../actions/ActionButtonView";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface ResourceStateViewProps {
  message: string;
  onRetry?(): void | Promise<void>;
  status: "error" | "loading";
}

export function ResourceStateView(props: ResourceStateViewProps): React.JSX.Element {
  const { message, onRetry, status } = props;
  const [retryPending, startRetry] = useTransition();
  const retry = useEvent((): void => {
    if (onRetry === undefined || retryPending) return;
    startRetry(async () => onRetry());
  });
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
        <ActionButtonView
          disabled={retryPending}
          label="Try again"
          onPress={retry}
          pending={retryPending}
        />
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

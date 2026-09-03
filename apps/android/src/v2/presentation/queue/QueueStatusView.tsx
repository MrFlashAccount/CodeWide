import { StyleSheet } from "react-native";

import { spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";

export interface QueueStatusViewProps {
  message: string;
  tone?: "danger" | "muted";
}

export function QueueStatusView(props: QueueStatusViewProps): React.JSX.Element {
  const { message, tone = "danger" } = props;
  return (
    <ProductText accessibilityLiveRegion="polite" style={styles.root} tone={tone}>
      {message}
    </ProductText>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, ...typeScale.caption },
});

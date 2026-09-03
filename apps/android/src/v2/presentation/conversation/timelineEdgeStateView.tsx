import { Pressable, StyleSheet } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import type { TimelineEdge } from "./timelineViewport";

interface TimelineEdgeStateViewProps {
  edge: TimelineEdge;
  failed: boolean;
  loading: boolean;
  onRetry(): void;
}

export function TimelineEdgeStateView(props: TimelineEdgeStateViewProps): React.JSX.Element | null {
  const { edge, failed, loading, onRetry } = props;
  if (loading)
    return (
      <ShimmerText containerStyle={styles.container} style={styles.text} text="Loading messages…" />
    );
  if (!failed) return null;
  return (
    <Pressable
      accessibilityLabel={`Retry loading ${edge} messages`}
      accessibilityRole="button"
      onPress={onRetry}
      style={styles.container}
    >
      <ProductText style={styles.failure}>Could not load messages. Tap to retry.</ProductText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: "center", paddingVertical: spacing.xs },
  failure: { ...typeScale.label, color: colors.red },
  text: { ...typeScale.label },
});

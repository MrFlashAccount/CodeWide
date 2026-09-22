import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { iconSize, radii, spacing, touchTarget, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

type PreviewStatus =
  | { readonly status: "loading" }
  | { readonly message: string; readonly retry: () => void; readonly status: "error" };

/** Keeps image loading and recovery centered and dismissible inside the safe fullscreen host. */
export function RouteImagePreviewStatus({
  onClose,
  state,
}: {
  readonly onClose: () => void;
  readonly state: PreviewStatus;
}): React.JSX.Element {
  return (
    <View style={styles.root} testID="route-image-status">
      <View style={styles.status}>
        <Ionicons color="#888888" name="image-outline" size={iconSize.illustration} />
        <PreviewStatusContent state={state} />
      </View>
      <Pressable
        accessibilityLabel="Close image"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.close}
      >
        <Ionicons color="#ffffff" name="close" size={iconSize.navigation} />
      </Pressable>
    </View>
  );
}

function PreviewStatusContent({ state }: { readonly state: PreviewStatus }): React.JSX.Element {
  if (state.status === "loading") {
    return <ActivityIndicator accessibilityLabel="Loading image preview" color="#ffffff" />;
  }
  return (
    <>
      <Text selectable style={styles.message}>
        {state.message}
      </Text>
      <Pressable accessibilityRole="button" onPress={state.retry} style={styles.retry}>
        <Text style={styles.message}>Retry</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  close: {
    alignItems: "center",
    backgroundColor: "rgba(36,36,36,0.9)",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    left: spacing.sm,
    position: "absolute",
    top: spacing.xs,
    width: touchTarget,
  },
  message: {
    color: "#ffffff",
    textAlign: "center",
    ...typeScale.body,
  },
  retry: {
    alignItems: "center",
    backgroundColor: "#242424",
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
  },
  root: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center",
  },
  status: {
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
});

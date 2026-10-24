import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, darkScheme, radii, spacing } from "../theme";

type AppRouteSheetProps = {
  readonly children: ReactNode;
  readonly dismissLabel: string;
  readonly onDismiss: () => void;
  readonly testID?: string;
};

const HANDLE_HEIGHT = 4;
const HANDLE_WIDTH = 36;
const MAX_SURFACE_WIDTH = 760;

/** Sheet-shaped content whose only presentation owner is its transparent native-stack route. */
export function AppRouteSheet(props: AppRouteSheetProps): React.JSX.Element {
  return (
    <View style={styles.route} testID={props.testID}>
      <Pressable
        accessibilityLabel={props.dismissLabel}
        accessibilityRole="button"
        onPress={props.onDismiss}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.surface}>
        <View style={styles.handle} />
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    alignSelf: "center",
    backgroundColor: colors.textDim,
    borderRadius: radii.pill,
    height: HANDLE_HEIGHT,
    marginBottom: spacing.sm,
    width: HANDLE_WIDTH,
  },
  route: {
    alignItems: "center",
    backgroundColor: darkScheme.scrim,
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  surface: {
    backgroundColor: colors.surfaceContainer,
    borderTopLeftRadius: radii.large,
    borderTopRightRadius: radii.large,
    maxHeight: "92%",
    maxWidth: MAX_SURFACE_WIDTH,
    minHeight: "62%",
    minWidth: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    width: "100%",
  },
});

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/** Retains one complete catalog while its search surface covers the same bounds. */
export function CatalogSearchOverlayHost({
  children,
  overlay,
  testID,
}: {
  readonly children: ReactNode;
  readonly overlay: ReactNode | null;
  readonly testID?: string;
}): React.JSX.Element {
  const searchVisible = overlay !== null;
  return (
    <View style={styles.fill} testID={testID}>
      <View
        accessibilityElementsHidden={searchVisible}
        importantForAccessibility={searchVisible ? "no-hide-descendants" : "auto"}
        pointerEvents={searchVisible ? "none" : "auto"}
        style={styles.fill}
      >
        {children}
      </View>
      {overlay === null ? null : <View style={StyleSheet.absoluteFill}>{overlay}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
});

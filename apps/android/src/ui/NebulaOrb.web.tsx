import { StyleSheet, View, type ViewProps } from "react-native";

import { colors, radii, spacing } from "../theme";

type NebulaOrbProps = ViewProps & {
  readonly level?: number;
};

/** Static web fallback; the persistent voice companion is an Android system surface. */
export function NebulaOrb({ level: _level, style, ...props }: NebulaOrbProps): React.JSX.Element {
  return <View {...props} style={[styles.orb, style]} />;
}

const styles = StyleSheet.create({
  orb: {
    backgroundColor: colors.nebula,
    borderColor: colors.nebulaHighlight,
    borderRadius: radii.pill,
    borderWidth: spacing.optical,
  },
});

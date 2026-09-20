import { StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../theme";
import { NebulaOrb } from "./NebulaOrb";
import type { VoiceAssistantOrbProps } from "./VoiceAssistantOrb.types";

export type { VoiceAssistantOrbProps } from "./VoiceAssistantOrb.types";

/** Static browser fallback that still reflects the selected renderer style. */
export function VoiceAssistantOrb({
  level,
  orbState,
  orbStyle,
  style,
  ...props
}: VoiceAssistantOrbProps): React.JSX.Element {
  const disabledStyle = orbState === "disabled" ? styles.disabled : null;
  if (orbStyle === "nebula") {
    return (
      <NebulaOrb
        {...props}
        level={level ?? 0}
        style={[styles.orb, styles.nebula, disabledStyle, style]}
      />
    );
  }
  return <View {...props} style={[styles.orb, styles.particles, disabledStyle, style]} />;
}

const styles = StyleSheet.create({
  disabled: {
    backgroundColor: colors.textDim,
    borderColor: colors.textMuted,
  },
  nebula: {
    backgroundColor: colors.nebula,
    borderColor: colors.nebulaHighlight,
  },
  orb: {
    borderRadius: radii.pill,
    borderWidth: spacing.optical,
  },
  particles: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.nebula,
    borderStyle: "dotted",
  },
});

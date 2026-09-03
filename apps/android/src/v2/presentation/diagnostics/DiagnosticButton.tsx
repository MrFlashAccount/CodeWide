import { Pressable, StyleSheet } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface DiagnosticButtonProps {
  label: string;
  onPress(): void;
  pending: boolean;
}

export function DiagnosticButton(props: DiagnosticButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: props.pending, disabled: props.pending }}
      disabled={props.pending}
      onPress={props.onPress}
      style={styles.button}
    >
      {props.pending ? (
        <ShimmerText style={styles.buttonText} text={props.label} />
      ) : (
        <ProductText style={styles.buttonText}>{props.label}</ProductText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  buttonText: { ...typeScale.label },
});

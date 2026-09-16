import { type ReactNode, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";

type AppButtonVariant = "danger" | "danger-soft" | "ghost" | "outline" | "primary" | "secondary";

interface AppButtonProps extends Omit<PressableProps, "children" | "disabled" | "style"> {
  readonly children: ReactNode;
  readonly isDisabled?: boolean;
  readonly isIconOnly?: boolean;
  readonly size?: "sm" | "md";
  readonly style?: StyleProp<ViewStyle>;
  readonly variant?: AppButtonVariant;
}

/** Shared application button with the small variant set used by both generations. */
export function AppButton(props: AppButtonProps): React.JSX.Element {
  const {
    children,
    isDisabled = false,
    isIconOnly = false,
    size = "md",
    style,
    variant = "primary",
    ...pressableProps
  } = props;
  const [pressed, setPressed] = useState(false);
  const pressIn = useEvent<NonNullable<PressableProps["onPressIn"]>>((event) => {
    setPressed(true);
    pressableProps.onPressIn?.(event);
  });
  const pressOut = useEvent<NonNullable<PressableProps["onPressOut"]>>((event) => {
    setPressed(false);
    pressableProps.onPressOut?.(event);
  });
  const textChild = typeof children === "string" || typeof children === "number";
  return (
    <Pressable
      {...pressableProps}
      accessibilityRole={pressableProps.accessibilityRole ?? "button"}
      accessibilityState={{ ...pressableProps.accessibilityState, disabled: isDisabled }}
      disabled={isDisabled}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[
        styles.base,
        size === "sm" ? styles.small : styles.medium,
        isIconOnly && styles.iconOnly,
        buttonVariantStyles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {textChild ? (
        <Text style={[styles.label, buttonLabelStyles[variant]]}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  danger: { backgroundColor: colors.red },
  dangerSoft: { backgroundColor: colors.errorContainer },
  disabled: { opacity: 0.5 },
  ghost: { backgroundColor: "transparent" },
  iconOnly: { paddingHorizontal: 0, width: controlSize.regular },
  label: {
    ...typeScale.body,
    fontWeight: typeWeight.medium,
  },
  medium: { minHeight: controlSize.touch },
  outline: {
    backgroundColor: "transparent",
    borderColor: colors.border,
    borderWidth: 1,
  },
  pressed: { opacity: 0.72 },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surfaceContainerHigh },
  small: { minHeight: controlSize.regular },
  text: { color: colors.text },
  textOnPrimary: { color: colors.onPrimary },
});

const buttonVariantStyles: Record<AppButtonVariant, ViewStyle> = {
  danger: styles.danger,
  "danger-soft": styles.dangerSoft,
  ghost: styles.ghost,
  outline: styles.outline,
  primary: styles.primary,
  secondary: styles.secondary,
};

const buttonLabelStyles: Record<AppButtonVariant, { readonly color: string }> = {
  danger: styles.textOnPrimary,
  "danger-soft": styles.text,
  ghost: styles.text,
  outline: styles.text,
  primary: styles.textOnPrimary,
  secondary: styles.text,
};

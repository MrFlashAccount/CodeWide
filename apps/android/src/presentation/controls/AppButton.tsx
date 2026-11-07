import { type ReactNode, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useEvent } from "../../react/useEvent";
import { TextShimmer } from "../../ui/TextShimmer";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";

type AppButtonVariant = "danger" | "danger-soft" | "ghost" | "outline" | "primary" | "secondary";

interface AppButtonProps extends Omit<PressableProps, "children" | "disabled" | "style"> {
  readonly children: ReactNode;
  readonly isDisabled?: boolean;
  readonly isIconOnly?: boolean;
  /** A text label shimmers in place while its operation is pending; geometry never changes. */
  readonly pending?: boolean;
  readonly size?: "sm" | "md";
  readonly style?: StyleProp<ViewStyle>;
  readonly variant?: AppButtonVariant;
}

const DISABLED_OPACITY = 0.5;
const PRESSED_OPACITY = 0.72;

interface ButtonVisualState {
  isDisabled: boolean;
  isIconOnly: boolean;
  pressed: boolean;
  size: "sm" | "md";
  style: StyleProp<ViewStyle>;
  variant: AppButtonVariant;
}

/** Shared application button with the variants used by V1 surfaces. */
export function AppButton(props: AppButtonProps): React.JSX.Element {
  const {
    children,
    isDisabled = false,
    isIconOnly = false,
    pending = false,
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
  return (
    <Pressable
      {...pressableProps}
      accessibilityRole={pressableProps.accessibilityRole ?? "button"}
      accessibilityState={buttonAccessibilityState(
        pressableProps.accessibilityState,
        pending,
        isDisabled,
      )}
      disabled={isDisabled}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={buttonStyle({ isDisabled, isIconOnly, pressed, size, style, variant })}
    >
      <ButtonContent pending={pending} variant={variant}>
        {children}
      </ButtonContent>
    </Pressable>
  );
}

/** A pending button is busy; callers may still mark it busy themselves. */
function buttonAccessibilityState(
  state: PressableProps["accessibilityState"],
  pending: boolean,
  disabled: boolean,
): PressableProps["accessibilityState"] {
  return { ...state, busy: pending || state?.busy, disabled };
}

/** A text child gets the variant's label style and shimmers in place while pending. */
function ButtonContent({
  children,
  pending,
  variant,
}: {
  readonly children: ReactNode;
  readonly pending: boolean;
  readonly variant: AppButtonVariant;
}): ReactNode {
  const label = useRef<Text>(null);
  if (typeof children !== "string" && typeof children !== "number") {
    return children;
  }
  return (
    <>
      <Text ref={label} style={[styles.label, buttonLabelStyles[variant]]}>
        {children}
      </Text>
      <TextShimmer shimmering={pending} target={label} />
    </>
  );
}

function buttonStyle(state: ButtonVisualState): StyleProp<ViewStyle> {
  return [
    styles.base,
    state.size === "sm" ? styles.small : styles.medium,
    state.isIconOnly && styles.iconOnly,
    buttonVariantStyles[state.variant],
    state.pressed && !state.isDisabled && styles.pressed,
    state.isDisabled && styles.disabled,
    state.style,
  ];
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
  disabled: { opacity: DISABLED_OPACITY },
  ghost: { backgroundColor: "transparent" },
  iconOnly: {
    paddingHorizontal: 0,
    width: controlSize.regular,
  },
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
  pressed: { opacity: PRESSED_OPACITY },
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

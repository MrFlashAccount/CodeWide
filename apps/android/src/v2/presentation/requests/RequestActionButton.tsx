import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { ProductText } from "../text/ProductText";
import { requestStyles } from "./requestStyles";

interface RequestActionButtonProps {
  disabled: boolean;
  label: string;
  onPress(): void;
  pending: boolean;
  tone: "danger" | "primary" | "secondary";
}

export function RequestActionButton(props: RequestActionButtonProps): React.JSX.Element {
  const { disabled, label, onPress, pending, tone } = props;
  const buttonStyle =
    tone === "primary"
      ? requestStyles.primaryAction
      : tone === "danger"
        ? requestStyles.destructiveAction
        : requestStyles.secondaryAction;
  const style: StyleProp<ViewStyle> = [
    requestStyles.action,
    buttonStyle,
    disabled && requestStyles.disabled,
  ];
  return (
    <Pressable
      android_ripple={ANDROID_RIPPLE}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={style}
    >
      <ProductText
        style={tone === "primary" ? requestStyles.primaryActionLabel : undefined}
        weight="semibold"
      >
        {label}
      </ProductText>
    </Pressable>
  );
}

const ANDROID_RIPPLE = { color: "rgba(255, 255, 255, 0.12)" };

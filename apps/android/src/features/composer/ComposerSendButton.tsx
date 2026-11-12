import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";

import { colors, iconSize } from "../../theme";
import { styles } from "./ComposerSubmitAction.styles";

/** Props of the composer's round send control without the chat's delivery gestures. */
export type ComposerSendButtonProps = {
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
};

/**
 * The chat composer's round send control (arrow up on the primary surface) for
 * inputs that send one text and have no queue, steer or discard gestures, such
 * as the review line composer. It owns no state.
 */
export function ComposerSendButton(props: ComposerSendButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      hitSlop={6}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.sendButton,
        pressed && styles.sendButtonPressed,
        props.disabled && styles.disabled,
      ]}
      testID={props.testID}
    >
      <Ionicons color={colors.onPrimary} name="arrow-up" size={iconSize.action} />
    </Pressable>
  );
}

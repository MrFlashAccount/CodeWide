import { Pressable } from "react-native";
import { useEvent } from "../react/useEvent";
import type { RowActionTriggerProps } from "./RowActionTrigger.types";

/** Browser button activation retains the caller's row content and layout. */
export function RowActionTrigger({
  gestureTestId: _gestureTestId,
  onLongPress,
  onPress,
  ...props
}: RowActionTriggerProps): React.JSX.Element {
  const press = useEvent(() => onPress?.());
  const open = useEvent(() => onLongPress?.());
  return <Pressable {...props} onLongPress={open} onPress={press} />;
}

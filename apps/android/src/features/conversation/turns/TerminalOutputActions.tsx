import { Pressable } from "react-native";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "../content/FullContentViewer.styles";

/** Offers recovery only when reading output failed. */
export function TerminalOutputActions({
  retry,
}: {
  readonly retry: (() => void) | null;
}): React.JSX.Element | null {
  if (retry === null) {
    return null;
  }
  return (
    <Pressable accessibilityRole="button" onPress={retry}>
      <Text style={styles.menuNotice}>Retry output</Text>
    </Pressable>
  );
}

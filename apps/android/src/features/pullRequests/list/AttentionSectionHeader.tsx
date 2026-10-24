import { View } from "react-native";

import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";

/** One of the two stable PR activity groups. */
export function AttentionSectionHeader({
  count,
  state,
}: {
  readonly count: number;
  readonly state: "new" | "seen";
}): React.JSX.Element {
  return (
    <View accessibilityRole="header" style={styles.section}>
      {state === "new" ? <View style={styles.attentionDot} /> : null}
      <Text style={styles.sectionLabel}>{state === "new" ? "NEED ATTENTION" : "UP TO DATE"}</Text>
      <Text style={styles.age}>{String(count)}</Text>
    </View>
  );
}

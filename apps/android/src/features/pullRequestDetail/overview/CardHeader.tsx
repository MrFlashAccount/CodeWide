import { View } from "react-native";

import { AppText as Text } from "../../../ui/Typography";
import { overviewStyles as styles } from "./overview.styles";

/** One muted text line inside a card. */
export function CardNote({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <View style={styles.cardLine}>
      <Text style={styles.meta}>{text}</Text>
    </View>
  );
}

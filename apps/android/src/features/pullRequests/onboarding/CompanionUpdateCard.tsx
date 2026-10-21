import { View } from "react-native";

import { ProductText } from "../../../presentation/text/ProductText";
import { onboardingStyles as styles } from "./onboarding.styles";

/** Shown when the companion does not know the forge methods (it answered method-not-found). */
export function CompanionUpdateCard(): React.JSX.Element {
  return (
    <View style={[styles.list, styles.fill]} testID="forge-companion-update">
      <View style={styles.card}>
        <ProductText style={styles.title}>Update the companion</ProductText>
        <ProductText style={styles.body}>
          This companion is too old for pull requests. Update CodeWide on the host, then reopen this
          tab.
        </ProductText>
      </View>
    </View>
  );
}

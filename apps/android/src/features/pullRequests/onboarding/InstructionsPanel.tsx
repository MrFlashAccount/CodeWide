import { View } from "react-native";

import type { AuthMethod } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { onboardingStyles as styles } from "./onboarding.styles";

/**
 * Host steps for a provider that cannot connect from the phone, for example
 * when its host tool is missing. A token is never typed here; Check again
 * re-reads the methods after the user acted on the host.
 */
export function InstructionsPanel({
  checking,
  method,
  onCheckAgain,
}: {
  readonly checking: boolean;
  readonly method: AuthMethod;
  readonly onCheckAgain: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <ProductText selectable style={styles.body}>
        {method.detail}
      </ProductText>
      <View style={styles.actions}>
        <AppButton isDisabled={checking} onPress={onCheckAgain} variant="secondary">
          Check again
        </AppButton>
      </View>
    </View>
  );
}

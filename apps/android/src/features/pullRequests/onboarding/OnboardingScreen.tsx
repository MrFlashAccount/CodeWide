import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { Tray } from "../../../vendor/reacticx/tray";
import { ProductText } from "../../../presentation/text/ProductText";
import { colors, iconSize } from "../../../theme";
import { onboardingStyles as styles } from "./onboarding.styles";

/**
 * Pull requests welcome with one action; provider and method choices live in
 * the server-driven tray instead of competing on the empty screen.
 */
export function OnboardingScreen(): React.JSX.Element {
  return (
    <View style={styles.welcome} testID="forge-onboarding">
      <WelcomeCopy />
    </View>
  );
}

function WelcomeCopy(): React.JSX.Element {
  return (
    <View style={styles.welcomeCopy}>
      <View style={styles.welcomeMark}>
        <Ionicons
          color={colors.textMuted}
          name="git-pull-request-outline"
          size={iconSize.illustration}
        />
      </View>
      <ProductText accessibilityRole="header" style={styles.welcomeTitle} weight="semibold">
        Your review inbox
      </ProductText>
      <ProductText style={styles.welcomeBody}>
        Connect a code host to see every pull request that needs you.
      </ProductText>
      <Tray.Trigger style={styles.welcomeButton}>
        <Ionicons color={colors.onPrimary} name="add" size={iconSize.action} />
        <ProductText style={styles.welcomeButtonLabel} weight="semibold">
          Connect a provider
        </ProductText>
      </Tray.Trigger>
      <View style={[styles.trust, styles.welcomeTrust]}>
        <Ionicons color={colors.textMuted} name="shield-checkmark-outline" size={iconSize.inline} />
        <ProductText style={styles.providerCaption}>
          Credentials stay on your Companion.
        </ProductText>
      </View>
    </View>
  );
}

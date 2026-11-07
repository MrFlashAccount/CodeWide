import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import type { ForgeAccountsSnapshot } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { colors, iconSize } from "../../../theme";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { onboardingStyles as styles } from "./onboarding.styles";
import { ProviderConnectTray } from "./ProviderConnectTray";

/**
 * Pull requests welcome with one action; provider and method choices live in
 * the server-driven tray instead of competing on the empty screen.
 */
export function OnboardingScreen({
  capabilities,
  connectionId,
  onTrayOpenChange,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onTrayOpenChange: (open: boolean) => void;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  return (
    <View style={styles.welcome} testID="forge-onboarding">
      <WelcomeCopy
        capabilities={capabilities}
        connectionId={connectionId}
        onTrayOpenChange={onTrayOpenChange}
        snapshot={snapshot}
      />
    </View>
  );
}

function WelcomeCopy({
  capabilities,
  connectionId,
  onTrayOpenChange,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onTrayOpenChange: (open: boolean) => void;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
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
      <ProviderConnectTray
        capabilities={capabilities}
        connectionId={connectionId}
        onOpenChange={onTrayOpenChange}
        snapshot={snapshot}
      />
      <View style={[styles.trust, styles.welcomeTrust]}>
        <Ionicons color={colors.textMuted} name="shield-checkmark-outline" size={iconSize.inline} />
        <ProductText style={styles.providerCaption}>
          Credentials stay on your Companion.
        </ProductText>
      </View>
    </View>
  );
}

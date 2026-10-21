import { Linking, View } from "react-native";

import type { AuthFlow } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { onboardingStyles as styles } from "./onboarding.styles";
import { safeProviderUrl } from "../../../data/forgeProviderUrl";

/**
 * A live host-login flow: the one-time code as selectable text and one button
 * that opens the verification page in the external browser. The page opens
 * only when it is `https` on the flow's host; otherwise the card says so.
 */
export function HostLoginPanel({
  cancelling,
  flow,
  onCancel,
}: {
  readonly cancelling: boolean;
  readonly flow: Extract<AuthFlow, { readonly state: "awaitingUser" }>;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const url = safeProviderUrl(flow.verificationUri, flow.host);
  const open = useEvent((): void => {
    if (url !== null) {
      // Without a browser the code stays visible for entry on another device.
      Linking.openURL(url).catch(() => undefined);
    }
  });
  return (
    <View style={styles.section} testID="forge-host-login-panel">
      <ProductText style={styles.body}>
        Enter this code on {flow.host}. You can finish on this phone; the companion completes the
        sign-in.
      </ProductText>
      <View style={styles.codeBox}>
        <ProductText
          accessibilityLabel={`One-time code ${flow.userCode}`}
          selectable
          style={styles.code}
        >
          {flow.userCode}
        </ProductText>
      </View>
      {url === null ? (
        <ProductText style={styles.error}>
          The verification page is not on {flow.host}. Run gh auth login on the companion host.
        </ProductText>
      ) : null}
      <View style={styles.actions}>
        <AppButton
          accessibilityLabel={`Open ${flow.host} verification page`}
          isDisabled={url === null}
          onPress={open}
          variant="primary"
        >
          {`Open ${flow.host}`}
        </AppButton>
        <AppButton isDisabled={cancelling} onPress={onCancel} variant="ghost">
          Cancel
        </AppButton>
      </View>
    </View>
  );
}

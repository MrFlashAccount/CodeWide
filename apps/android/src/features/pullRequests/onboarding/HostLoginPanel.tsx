import { Ionicons } from "@expo/vector-icons";
import { setStringAsync } from "expo-clipboard";
import { Linking, View } from "react-native";

import type { AuthFlow } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppText } from "../../../ui/AppText";
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
  const dialog = useAppDialog();
  const url = safeProviderUrl(flow.verificationUri, flow.host);
  const copy = useEvent((): void => {
    setStringAsync(flow.userCode).catch((error: unknown) => {
      dialog.alert("Copy failed", error instanceof Error ? error.message : "Could not copy code");
    });
  });
  const open = useEvent((): void => {
    if (url !== null) {
      // Without a browser the code stays visible for entry on another device.
      Linking.openURL(url).catch(() => undefined);
    }
  });
  return (
    <View style={styles.hostLoginPanel} testID="forge-host-login-panel">
      <ProductText style={styles.body}>Enter this one-time code on {flow.host}.</ProductText>
      <View style={styles.hostLoginCodeBox}>
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
      <HostLoginFooter
        cancelling={cancelling}
        host={flow.host}
        onCancel={onCancel}
        onCopy={copy}
        onOpen={open}
        openAvailable={url !== null}
      />
    </View>
  );
}

function HostLoginFooter({
  cancelling,
  host,
  onCancel,
  onCopy,
  onOpen,
  openAvailable,
}: {
  readonly cancelling: boolean;
  readonly host: string;
  readonly onCancel: () => void;
  readonly onCopy: () => void;
  readonly onOpen: () => void;
  readonly openAvailable: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.hostLoginFooter}>
      <AppText shimmering style={styles.hostLoginStatus}>
        Waiting for authorization…
      </AppText>
      <HostLoginControls
        cancelling={cancelling}
        host={host}
        onCancel={onCancel}
        onCopy={onCopy}
        onOpen={onOpen}
        openAvailable={openAvailable}
      />
    </View>
  );
}

function HostLoginControls({
  cancelling,
  host,
  onCancel,
  onCopy,
  onOpen,
  openAvailable,
}: {
  readonly cancelling: boolean;
  readonly host: string;
  readonly onCancel: () => void;
  readonly onCopy: () => void;
  readonly onOpen: () => void;
  readonly openAvailable: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.hostLoginControls} testID="forge-host-login-controls">
      <AppButton
        accessibilityLabel="Cancel sign-in"
        isDisabled={cancelling}
        onPress={onCancel}
        size="sm"
        variant="ghost"
      >
        Cancel
      </AppButton>
      <View style={styles.hostLoginActions} testID="forge-host-login-actions">
        <AppButton
          accessibilityLabel="Copy one-time code"
          onPress={onCopy}
          size="sm"
          variant="ghost"
        >
          Copy code
        </AppButton>
        <OpenHostButton host={host} onPress={onOpen} openAvailable={openAvailable} />
      </View>
    </View>
  );
}

function OpenHostButton({
  host,
  onPress,
  openAvailable,
}: {
  readonly host: string;
  readonly onPress: () => void;
  readonly openAvailable: boolean;
}): React.JSX.Element {
  return (
    <AppButton
      accessibilityLabel={`Open ${host} verification page`}
      isDisabled={!openAvailable}
      onPress={onPress}
      size="sm"
      style={styles.hostLoginOpenButton}
      variant="primary"
    >
      <Ionicons color={colors.onPrimary} name="open-outline" size={iconSize.inline} />
      <ProductText style={styles.hostLoginOpenLabel} weight="semibold">
        {`Open ${host}`}
      </ProductText>
    </AppButton>
  );
}

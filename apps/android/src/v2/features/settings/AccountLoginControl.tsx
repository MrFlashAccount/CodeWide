import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { AccountLoginSheetView } from "../../presentation/settings/AccountLoginSheetView";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { cancelAccountLogin, startAccountLogin } from "./accountCommands";
import { useAccountLogin } from "./useAccountLogin";

interface AccountLoginControlProps {
  copyLoginCode(value: string): Promise<void>;
  disabled: boolean;
  openLoginUrl(value: string): Promise<void>;
  savedServerId: SavedServerId;
}

/** Starts one V2 device-code login and owns its ephemeral code sheet. */
export function AccountLoginControl(props: AccountLoginControlProps): React.JSX.Element {
  const { copyLoginCode, disabled, openLoginUrl, savedServerId } = props;
  const runtime = useV2Runtime();
  const login = useAccountLogin({
    cancel: (loginId) => cancelAccountLogin(runtime.commandActivations, savedServerId, loginId),
    copy: copyLoginCode,
    open: openLoginUrl,
    start: () => startAccountLogin(runtime.commandActivations, savedServerId),
  });
  return (
    <>
      <Pressable
        accessibilityLabel="Add Codex account"
        accessibilityState={{ busy: login.pending, disabled: disabled || login.pending }}
        disabled={disabled || login.pending}
        onPress={login.begin}
        style={[styles.addButton, (disabled || login.pending) && styles.disabled]}
      >
        <Ionicons color={colors.text} name="person-add-outline" size={17} />
        {login.pending && login.login === null ? (
          <ShimmerText style={styles.addButtonText} text="Starting sign-in" />
        ) : (
          <Text style={styles.addButtonText}>Add Codex account</Text>
        )}
      </Pressable>
      {login.error === null || login.login !== null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {login.error}
        </Text>
      )}
      {login.login === null ? null : (
        <AccountLoginSheetView
          codeCopied={login.codeCopied}
          error={login.error}
          onClose={login.close}
          onCopy={login.copyCode}
          onOpen={login.openSignIn}
          pending={login.pending}
          userCode={login.login.userCode}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: "center",
    borderColor: colors.borderSoft,
    borderRadius: radii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: touchTarget,
  },
  addButtonText: { color: colors.text, ...typeScale.body },
  disabled: { opacity: 0.55 },
  error: { color: colors.red, paddingVertical: spacing.sm },
});

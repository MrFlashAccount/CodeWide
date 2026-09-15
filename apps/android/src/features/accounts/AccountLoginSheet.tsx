/** V1 AccountPoolFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppSheet } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";

export function AccountLoginSheet({
  userCode,
  codeCopied,
  loginActionBusy,
  closeAccountLogin,
  copyAccountCode,
  openAccountSignIn,
}: {
  userCode: string;
  codeCopied: boolean;
  loginActionBusy: boolean;
  closeAccountLogin(): void;
  copyAccountCode(): Promise<void>;
  openAccountSignIn(): Promise<void>;
}) {
  return (
    <AppSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) closeAccountLogin();
      }}
      contentProps={{
        dismissLabel: "Close Codex account sign-in",
        index: 0,
        enableDynamicSizing: true,
        enableOverDrag: false,
      }}
    >
      <View style={styles.accountLoginSheet}>
        <View style={styles.accountLoginHeader}>
          <View style={styles.accountLoginIcon}>
            <Ionicons name="people-outline" size={iconSize.action} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.accountLoginTitle}>Connect Codex account</Text>
            <Text style={styles.accountLoginSubtitle}>
              Sign in to add this account as an automatic fallback.
            </Text>
          </View>
        </View>
        <View style={styles.accountLoginCodeCard}>
          <View style={styles.flex}>
            <Text style={styles.accountLoginCodeLabel}>One-time code</Text>
            <Text selectable style={styles.accountLoginCode}>
              {userCode}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy one-time Codex sign-in code"
            onPress={() => void copyAccountCode()}
            style={[styles.accountLoginCopyButton, codeCopied && styles.accountLoginCopyButtonDone]}
          >
            <Ionicons
              name={codeCopied ? "checkmark" : "copy-outline"}
              size={iconSize.inline}
              color={codeCopied ? colors.green : colors.text}
            />
            <Text
              style={[styles.accountLoginCopyLabel, codeCopied && styles.accountLoginCopyLabelDone]}
            >
              {codeCopied ? "Copied" : "Copy"}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.accountLoginHint}>
          The code is copied automatically when you open sign-in. Paste it in the browser to finish
          connecting.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={loginActionBusy}
          onPress={() => void openAccountSignIn()}
          style={[
            styles.primaryButton,
            styles.accountLoginPrimaryButton,
            loginActionBusy && styles.disabled,
          ]}
        >
          {loginActionBusy ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons name="open-outline" size={iconSize.action} color={colors.onPrimary} />
          )}
          <Text style={styles.primaryButtonText}>
            {loginActionBusy ? "Opening…" : "Open sign-in"}
          </Text>
        </Pressable>
      </View>
    </AppSheet>
  );
}

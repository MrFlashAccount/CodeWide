/** V1 AccountPoolFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppSheet } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";

export function AccountLoginSheet({
  closeAccountLogin,
  codeCopied,
  copyAccountCode,
  loginActionBusy,
  openAccountSignIn,
  userCode,
}: {
  closeAccountLogin: () => void;
  codeCopied: boolean;
  copyAccountCode: () => Promise<void>;
  loginActionBusy: boolean;
  openAccountSignIn: () => Promise<void>;
  userCode: string;
}) {
  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close Codex account sign-in",
        enableDynamicSizing: true,
        enableOverDrag: false,
        index: 0,
      }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          closeAccountLogin();
        }
      }}
    >
      <View style={styles.accountLoginSheet}>
        <View style={styles.accountLoginHeader}>
          <View style={styles.accountLoginIcon}>
            <Ionicons color={colors.primary} name="people-outline" size={iconSize.action} />
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
            accessibilityLabel="Copy one-time Codex sign-in code"
            accessibilityRole="button"
            onPress={() => void copyAccountCode()}
            style={[styles.accountLoginCopyButton, codeCopied && styles.accountLoginCopyButtonDone]}
          >
            <Ionicons
              color={codeCopied ? colors.green : colors.text}
              name={codeCopied ? "checkmark" : "copy-outline"}
              size={iconSize.inline}
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
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <Ionicons color={colors.onPrimary} name="open-outline" size={iconSize.action} />
          )}
          <Text style={styles.primaryButtonText}>
            {loginActionBusy ? "Opening…" : "Open sign-in"}
          </Text>
        </Pressable>
      </View>
    </AppSheet>
  );
}

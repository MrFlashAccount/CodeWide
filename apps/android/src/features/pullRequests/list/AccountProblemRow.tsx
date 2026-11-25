import { View } from "react-native";

import type { AccountState } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";

/** The reason and the next step each get two lines, so both stay readable at 320dp. */
const PROBLEM_LINES = 2;

/**
 * One row in place of an expired or failing account's PRs. It degrades only
 * its own section and offers one next step; no token is ever entered here.
 */
export function AccountProblemRow({
  account,
  onReconnect,
  onRetry,
}: {
  readonly account: Exclude<AccountState, { readonly state: "connected" }>;
  readonly onReconnect: (account: AccountState) => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const expired = account.state === "expired";
  return (
    <View style={styles.row} testID={`forge-account-problem-${account.state}`}>
      <View style={styles.rowLead}>
        <Text
          accessibilityLabel={expired ? "Expired" : "Error"}
          style={expired ? styles.problemExpired : styles.problemError}
        >
          !
        </Text>
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={PROBLEM_LINES} style={styles.title}>
          {expired ? "Sign-in expired on host" : "Account unavailable"}
        </Text>
        <Text numberOfLines={PROBLEM_LINES} style={styles.meta}>
          {expired ? account.hint : account.reason}
        </Text>
      </View>
      <AppButton
        onPress={() => {
          if (expired) {
            onReconnect(account);
          } else {
            onRetry();
          }
        }}
        size="sm"
        variant="outline"
      >
        {expired ? "Reconnect" : "Retry"}
      </AppButton>
    </View>
  );
}

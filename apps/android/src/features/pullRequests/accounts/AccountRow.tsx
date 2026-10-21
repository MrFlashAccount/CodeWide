import { View } from "react-native";

import type { AccountState, DisconnectMode, ForgeProvider } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { onboardingStyles as styles } from "../onboarding/onboarding.styles";
import {
  accountCredentialLine,
  accountStateLabel,
  DISCONNECT_LABELS,
  disconnectModes,
} from "./accountPresentation";

/** Header and reason lines may wrap once so host and login stay readable. */
const ACCOUNT_TEXT_LINES = 2;

/**
 * One linked account: state, credential source and scopes, its next step when
 * broken (Check again re-reads the host credential), and its disconnect modes
 * as equal-width actions.
 */
export function AccountRow({
  account,
  busy,
  checking,
  onCheckAgain,
  onDisconnect,
  provider,
}: {
  readonly account: AccountState;
  readonly busy: boolean;
  /** This account's Check again is waiting for the companion. */
  readonly checking: boolean;
  readonly onCheckAgain: (account: AccountState) => void;
  readonly onDisconnect: (account: AccountState, mode: DisconnectMode) => void;
  readonly provider: ForgeProvider | undefined;
}): React.JSX.Element {
  return (
    <View style={styles.card} testID={`forge-account-${account.login}`}>
      <View style={styles.header}>
        {provider === undefined ? null : (
          <ForgeIcon glyph={provider.icon.glyph} iconKey={provider.icon.iconKey} />
        )}
        <ProductText numberOfLines={ACCOUNT_TEXT_LINES} style={styles.title}>
          {`${account.host} · @${account.login}`}
        </ProductText>
      </View>
      <ProductText
        style={styles.body}
        tone={
          account.state === "connected"
            ? "success"
            : account.state === "expired"
              ? "warning"
              : "danger"
        }
      >
        {accountStateLabel(account)}
      </ProductText>
      <ProductText style={styles.body}>{accountCredentialLine(account)}</ProductText>
      {account.state === "connected" ? null : (
        <ProductText style={styles.body}>
          {account.state === "expired" ? account.hint : account.reason}
        </ProductText>
      )}
      {account.state === "connected" ? null : (
        <AppButton
          isDisabled={busy}
          onPress={() => {
            onCheckAgain(account);
          }}
          pending={checking}
          size="sm"
          style={styles.primaryButton}
          variant="secondary"
        >
          Check again
        </AppButton>
      )}
      <View style={styles.equalActions}>
        {disconnectModes(account, provider).map((mode) => (
          <AppButton
            isDisabled={busy}
            key={mode}
            onPress={() => {
              onDisconnect(account, mode);
            }}
            size="sm"
            style={styles.equalAction}
            variant={mode === "logoutHost" ? "outline" : "secondary"}
          >
            {DISCONNECT_LABELS[mode]}
          </AppButton>
        ))}
      </View>
    </View>
  );
}

import { View } from "react-native";

import type { AccountState, ForgeProvider } from "../../../data/forgeContract";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppListRow } from "../../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../../ui/AppListRow.types";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import type { ForgeAccountSelection } from "../forgeAccountSettingsPage";
import { accountsSheetStyles as styles } from "./AccountsSheet.styles";

/** One linked account in the server list, opening the next settings page. */
export function AccountRow({
  account,
  connectionId,
  open,
  position,
  provider,
}: {
  readonly account: AccountState;
  readonly connectionId: string;
  readonly open: (selection: ForgeAccountSelection) => void;
  readonly position: NonNullable<AppListRowProps["position"]>;
  readonly provider: ForgeProvider | undefined;
}): React.JSX.Element {
  const forgeName = provider?.forgeName ?? account.pluginId;
  const openDetails = useEvent(() => {
    open({ account: account.account, connectionId, login: account.login });
  });
  return (
    <View testID={`forge-account-${account.login}`}>
      <AppListRow
        accessibilityLabel={`@${account.login}, ${account.host}`}
        description={`${forgeName} · ${account.host}`}
        descriptionLeading={
          <View
            style={[styles.statusDot, { backgroundColor: statusColor(account) }]}
            testID={`forge-account-status-${account.login}`}
          />
        }
        fixedHeight={listRowHeight.double}
        leading={<ForgeIcon icon={provider?.icon ?? null} size={iconSize.action} />}
        onPress={openDetails}
        position={position}
        title={`@${account.login}`}
        trailingIcon={{ name: "chevron-forward" }}
      />
    </View>
  );
}

function statusColor(account: AccountState): string {
  if (account.state === "connected") {
    return colors.green;
  }
  return account.state === "expired" ? colors.amber : colors.red;
}

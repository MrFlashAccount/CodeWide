import { View } from "react-native";

import type { AccountState, ProviderIcon } from "../../../data/forgeContract";
import { iconSize } from "../../../theme";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";

/** `GITHUB.COM · @LOGIN` with the section's open count; a broken account stays one row below it. */
export function AccountSectionHeader({
  account,
  icon,
  openCount,
}: {
  readonly account: AccountState;
  /** The account's provider mark; rows carry none, so the section names the forge (N-06). */
  readonly icon: ProviderIcon | null;
  readonly openCount: number | null;
}): React.JSX.Element {
  return (
    <View accessibilityRole="header" style={styles.section}>
      <ForgeIcon glyph={icon?.glyph ?? null} iconKey={icon?.iconKey ?? ""} size={iconSize.inline} />
      <Text numberOfLines={1} style={styles.sectionLabel}>
        {`${account.host.toUpperCase()} · @${account.login.toUpperCase()}`}
      </Text>
      {openCount === null ? null : <Text style={styles.age}>{`${String(openCount)} open`}</Text>}
    </View>
  );
}

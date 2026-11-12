import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../theme";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { PortForwardingManager } from "./PortForwardingManager";
import type { PortForwardingManagerProps } from "./portForwardingContract";

/** Presents native port forwarding within the host-owned sheet. */
export function PortsFeature({
  portForwarding,
}: {
  portForwarding: PortForwardingManagerProps | undefined;
}): React.JSX.Element {
  if (portForwarding === undefined) {
    return <Text style={styles.notice}>Port forwarding is unavailable for this server</Text>;
  }
  return <PortForwardingManager {...portForwarding} scrollComponent={AppSheetScrollView} />;
}
const styles = StyleSheet.create({
  notice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
});

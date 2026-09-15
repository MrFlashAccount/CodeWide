import { StyleSheet } from "react-native";
import type { TunnelRow, TunnelValue } from "../../data/workspace-resource-database";
import { colors, spacing, typeScale } from "../../theme";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { LocalhostPreview } from "./LocalhostPreview";
import { PortForwardingManager } from "./PortForwardingManager";
import type { PortForwardingManagerProps } from "./portForwardingContract";

/** Select native forwarding or the existing explicit tunnel within the host-owned sheet. */
export function PortsFeature({
  mode,
  portForwarding,
  onClose,
  resource,
  onCreate,
  onRevoke,
}: {
  mode: "forwarding" | "runtime";
  portForwarding: PortForwardingManagerProps | undefined;
  onClose(): void;
  resource: TunnelRow | null;
  onCreate?(port: number, ttlSeconds: number): Promise<TunnelValue>;
  onRevoke?(tunnelId: string): Promise<void>;
}) {
  if (portForwarding !== undefined)
    return <PortForwardingManager {...portForwarding} renderScrollComponent={AppSheetScrollView} />;
  if (mode === "forwarding")
    return <Text style={styles.notice}>Port forwarding is unavailable for this server</Text>;
  return (
    <LocalhostPreview
      embedded
      visible
      onClose={onClose}
      resource={resource}
      {...(onCreate === undefined ? {} : { onCreate })}
      {...(onRevoke === undefined ? {} : { onRevoke })}
    />
  );
}
const styles = StyleSheet.create({
  notice: { color: colors.textMuted, ...typeScale.body, paddingVertical: spacing.xs },
});

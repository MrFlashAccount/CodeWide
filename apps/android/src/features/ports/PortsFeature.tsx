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
  onClose,
  onCreate,
  onOpenBrowser,
  onRevoke,
  portForwarding,
  resource,
}: {
  mode: "forwarding" | "runtime";
  onClose: () => void;
  onCreate?: (port: number, ttlSeconds: number) => Promise<TunnelValue>;
  onOpenBrowser?: (title: string, url: string, headers?: Readonly<Record<string, string>>) => void;
  onRevoke?: (tunnelId: string) => Promise<void>;
  portForwarding: PortForwardingManagerProps | undefined;
  resource: TunnelRow | null;
}) {
  if (portForwarding !== undefined) {
    return <PortForwardingManager {...portForwarding} renderScrollComponent={AppSheetScrollView} />;
  }
  if (mode === "forwarding") {
    return <Text style={styles.notice}>Port forwarding is unavailable for this server</Text>;
  }
  return (
    <LocalhostPreview
      embedded
      onClose={onClose}
      {...(onOpenBrowser === undefined ? {} : { onOpenBrowser })}
      resource={resource}
      visible
      {...(onCreate === undefined ? {} : { onCreate })}
      {...(onRevoke === undefined ? {} : { onRevoke })}
    />
  );
}
const styles = StyleSheet.create({
  notice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
});

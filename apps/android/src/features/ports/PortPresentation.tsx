import { Ionicons } from "@expo/vector-icons";
import { type ComponentProps } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./PortForwardingManager.styles";
import { type PortForwardingCandidate } from "./portForwardingContract";

export function ServiceIcon({
  name,
  live = false,
}: {
  name: ComponentProps<typeof Ionicons>["name"];
  live?: boolean;
}) {
  return (
    <View style={styles.serviceIcon}>
      <Ionicons name={name} size={iconSize.action} color={colors.textMuted} />
      {live && <View style={styles.liveDot} />}
    </View>
  );
}

export function SectionLabel({ value }: { value: string }) {
  return <Text style={styles.sectionLabel}>{value}</Text>;
}

export function InlineError({ value }: { value: string }) {
  return (
    <View accessibilityRole="alert" style={styles.inlineError}>
      <Ionicons name="alert-circle-outline" size={iconSize.inline} color={colors.red} />
      <Text style={styles.errorText}>{value}</Text>
    </View>
  );
}

export function InfoRow({
  icon,
  title,
  subtitle,
  loading = false,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  loading?: boolean;
}) {
  return (
    <AppListRow
      title={title}
      description={subtitle}
      multiline
      leading={<ServiceIcon name={icon} />}
      trailing={loading ? <ActivityIndicator size="small" color={colors.textDim} /> : undefined}
    />
  );
}

export function SmallAction({
  label,
  title,
  danger = false,
  onPress,
}: {
  label: string;
  title: string;
  danger?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={styles.smallAction}>
      <Text style={[styles.smallActionText, danger && { color: colors.red }]}>{title}</Text>
    </Pressable>
  );
}

export function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}

export function candidateIcon(
  kind: PortForwardingCandidate["kind"],
): ComponentProps<typeof Ionicons>["name"] {
  if (kind === "docker" || kind === "minikube") return "cube-outline";
  if (kind === "kubernetes") return "git-network-outline";
  if (kind === "node" || kind === "vite") return "logo-nodejs";
  if (kind === "python") return "code-slash-outline";
  if (kind === "zrok") return "globe-outline";
  if (kind === "system") return "settings-outline";
  if (kind === "hermes") return "chatbubble-ellipses-outline";
  return "terminal-outline";
}

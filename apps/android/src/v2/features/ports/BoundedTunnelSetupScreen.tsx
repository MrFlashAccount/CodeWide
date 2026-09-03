import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { portTunnelBrowserDestination } from "../navigation/routeDestinations";
import {
  PresentationTextInput as TextInput,
  ProductText as Text,
} from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

interface BoundedTunnelSetupScreenProps {
  savedServerId: SavedServerId;
}

const TTL_CHOICES = [
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
];

export function BoundedTunnelSetupScreen(props: BoundedTunnelSetupScreenProps): React.JSX.Element {
  const { savedServerId } = props;
  const runtime = useV2Runtime();
  const ports = runtime.ports(savedServerId);
  const [target, setTarget] = useState("localhost:3000");
  const [ttlSeconds, setTtlSeconds] = useState(300);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const close = useEvent(() => router.back());
  const open = useEvent(() => {
    const port = targetPort(target);
    if (port === null) {
      setError("Use localhost and a port between 1 and 65535.");
      return;
    }
    setError(null);
    startAction(async () => {
      try {
        const tunnel = await ports.createTunnel(port, ttlSeconds);
        router.push(
          portTunnelBrowserDestination(savedServerId, {
            expiresAt: tunnel.expiresAt,
            label: `localhost:${port}`,
            port,
            suffix: "",
            tunnelId: tunnel.id,
          }),
        );
      } catch (cause) {
        setError(errorMessage(cause, "Could not open localhost preview."));
      }
    });
  });
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close localhost preview" onPress={close} style={styles.icon}>
          <Ionicons color={colors.text} name="close" size={23} />
        </Pressable>
        <Text style={styles.headerTitle}>Localhost preview</Text>
      </View>
      <View style={styles.content}>
        <Ionicons color={colors.accent} name="globe-outline" size={38} />
        <Text style={styles.title}>Open a bounded localhost tunnel</Text>
        <Text style={styles.notice}>
          Only 127.0.0.1 on this server is reachable. The tunnel expires automatically.
        </Text>
        <Text style={styles.label}>Local service</Text>
        <TextInput
          accessibilityLabel="Local service"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setTarget}
          placeholder="localhost:3000"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          value={target}
        />
        <Text style={styles.label}>Keep open</Text>
        <View style={styles.choices}>
          {TTL_CHOICES.map((choice) => (
            <TtlChoice
              key={choice.value}
              choice={choice}
              onSelect={setTtlSeconds}
              selected={choice.value === ttlSeconds}
            />
          ))}
        </View>
        {error === null ? null : <Text style={styles.error}>{error}</Text>}
        <Pressable
          accessibilityLabel="Open localhost tunnel"
          disabled={pending}
          onPress={open}
          style={styles.primary}
        >
          {pending ? (
            <ShimmerText style={styles.primaryText} text="Opening" />
          ) : (
            <Text style={styles.primaryText}>Open preview</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

interface TtlChoiceProps {
  choice: { label: string; value: number };
  onSelect(value: number): void;
  selected: boolean;
}

function TtlChoice(props: TtlChoiceProps): React.JSX.Element {
  const { choice, onSelect, selected } = props;
  const select = useEvent(() => onSelect(choice.value));
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={select}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={styles.choiceText}>{choice.label}</Text>
    </Pressable>
  );
}

function targetPort(value: string): number | null {
  const target = value.trim();
  const match = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/u.exec(target);
  const raw = match?.[1] ?? (/^\d{1,5}$/u.test(target) ? target : null);
  if (raw === null) return null;
  const port = Number(raw);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  choice: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.large,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  choiceSelected: { backgroundColor: colors.primaryContainer },
  choiceText: { color: colors.text, ...typeScale.label },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  content: {
    alignSelf: "center",
    gap: spacing.sm,
    maxWidth: 560,
    padding: spacing.md,
    width: "100%",
  },
  error: { color: colors.red, ...typeScale.label },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: spacing.xs,
  },
  headerTitle: { color: colors.text, ...typeScale.title },
  icon: { alignItems: "center", height: touchTarget, justifyContent: "center", width: touchTarget },
  input: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  label: { color: colors.textMuted, ...typeScale.label },
  notice: { color: colors.textMuted, ...typeScale.body },
  primary: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryText: { color: colors.onPrimary, ...typeScale.body },
  root: { backgroundColor: colors.background, flex: 1 },
  title: { color: colors.text, ...typeScale.heading },
});

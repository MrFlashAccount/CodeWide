import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useSyncExternalStore, useTransition, type ComponentType } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import type { InternalBrowserContentProps } from "../../presentation/browser/InternalBrowserView";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, spacing, touchTarget, typeScale } from "../../theme";

interface BrowserScreenProps {
  browser: ComponentType<InternalBrowserContentProps>;
  profileId: string;
  savedServerId: SavedServerId;
}

export function BrowserScreen(props: BrowserScreenProps): React.JSX.Element {
  const { browser: Browser, profileId, savedServerId } = props;
  const runtime = useV2Runtime();
  const ports = runtime.ports(savedServerId);
  const snapshot = useSyncExternalStore(ports.subscribe, ports.snapshot, ports.snapshot);
  const profile = snapshot.value.profiles.find((value) => value.id === profileId) ?? null;
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const close = useEvent(() => router.back());
  const reportError = useEvent((message: string) => setBrowserError(message));
  const reportHttpError = useEvent((statusCode: number) => {
    setBrowserError(
      statusCode === 502
        ? "Nothing is listening on this remote port."
        : `Browser returned HTTP ${statusCode}.`,
    );
  });
  const reconnect = useEvent(() => {
    if (profile === null) return;
    setBrowserError(null);
    startAction(async () => {
      try {
        await ports.reconnect(profile.id);
      } catch (cause) {
        setBrowserError(message(cause, "Could not reconnect secure forwarding."));
      }
    });
  });
  if (
    profile === null ||
    profile.previewUrl === null ||
    profile.status !== "live" ||
    browserError !== null
  ) {
    return (
      <BrowserUnavailable
        error={browserError ?? profile?.error ?? unavailableMessage(profile?.status)}
        onClose={close}
        onReconnect={profile === null ? null : reconnect}
        pending={pending || profile?.status === "connecting"}
      />
    );
  }
  return (
    <Browser
      onClose={close}
      onError={reportError}
      onHttpError={reportHttpError}
      source={{ headers: null, uri: profile.previewUrl }}
      status="Live"
      title={profile.label}
    />
  );
}

interface BrowserUnavailableProps {
  error: string;
  onClose(): void;
  onReconnect: (() => void) | null;
  pending: boolean;
}

function BrowserUnavailable(props: BrowserUnavailableProps): React.JSX.Element {
  const { error, onClose, onReconnect, pending } = props;
  return (
    <View style={styles.root}>
      <Pressable accessibilityLabel="Close browser" onPress={onClose} style={styles.close}>
        <Ionicons color={colors.text} name="close" size={23} />
      </Pressable>
      <View style={styles.center}>
        {pending ? (
          <ShimmerText text="Connecting secure forwarding…" />
        ) : (
          <Text style={styles.error}>{error}</Text>
        )}
        {pending || onReconnect === null ? null : (
          <Pressable
            accessibilityLabel="Reconnect secure forwarding"
            onPress={onReconnect}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Reconnect</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function unavailableMessage(status: string | undefined): string {
  if (status === "unavailable") return "Nothing is listening on this remote port.";
  if (status === "stopped") return "This secure forwarding is stopped.";
  return "This secure forwarding is unavailable.";
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.lg,
  },
  close: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  error: { color: colors.red, textAlign: "center", ...typeScale.body },
  retry: { minHeight: touchTarget, justifyContent: "center", paddingHorizontal: spacing.md },
  retryText: { color: colors.accent, ...typeScale.body },
  root: { backgroundColor: colors.background, flex: 1 },
});

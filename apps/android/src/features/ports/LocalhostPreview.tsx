import type { TunnelValue } from "../../data/workspace-resource-database";
/** V1 LocalhostPreview owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { TunnelRow } from "../../data/workspace-resource-database";
import { colors, iconSize } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./LocalhostPreview.styles";

export function LocalhostPreview({
  embedded = false,
  onClose,
  onCreate,
  onOpenBrowser,
  onRevoke,
  resource,
  visible,
}: {
  embedded?: boolean;
  onClose: () => void;
  onCreate?: (port: number, ttlSeconds: number) => Promise<TunnelValue>;
  onOpenBrowser?: (title: string, url: string, headers?: Readonly<Record<string, string>>) => void;
  onRevoke?: (tunnelId: string) => Promise<void>;
  resource: TunnelRow | null;
  visible: boolean;
}) {
  const [target, setTarget] = useState("localhost:3000");
  const [ttl, setTtl] = useState("300");
  const tunnel = resource?.tunnel ?? null;
  const loading = resource?.status === "creating" || resource?.status === "revoking";
  const [error, setError] = useState<string | null>(null);
  const effectiveError = error ?? resource?.error ?? null;
  const close = () => {
    const active = tunnel;
    setError(null);
    if (active !== null && onRevoke !== undefined) {
      onRevoke(active.id).then(onClose, (error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not revoke localhost tunnel");
      });
    } else {
      onClose();
    }
  };
  const create = async () => {
    if (onCreate === undefined) {
      return;
    }
    setError(null);
    try {
      const created = await onCreate(localhostTargetPort(target), Number(ttl));
      openCreatedTunnel(onOpenBrowser, created);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open localhost preview");
    }
  };
  const content = (
    <View style={[styles.previewRoot, embedded && styles.previewEmbeddedRoot]}>
      {!embedded && tunnel === null && (
        <View style={styles.previewHeader}>
          <Pressable
            accessibilityLabel="Close localhost preview"
            onPress={close}
            style={styles.headerIcon}
          >
            <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
          </Pressable>
          <View style={styles.previewIdentity}>
            <Text numberOfLines={1} style={styles.conversationTitle}>
              Localhost preview
            </Text>
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.conversationSubtitle}>
              Explicit server-scoped tunnel
            </Text>
          </View>
        </View>
      )}
      {tunnel === null ? (
        <View style={styles.previewSetup}>
          <Ionicons color={colors.accent} name="globe-outline" size={iconSize.illustration} />
          <Text style={styles.sheetTitle}>Open a bounded localhost tunnel</Text>
          <Text style={styles.menuNotice}>
            Only 127.0.0.1 on the selected Codex server is reachable. The tunnel expires
            automatically.
          </Text>
          <Text style={styles.fieldLabel}>Local service</Text>
          <TextInput
            accessibilityLabel="Local service"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTarget}
            placeholder="localhost:3000"
            placeholderTextColor={colors.textDim}
            style={styles.fieldInput}
            value={target}
            voiceInput={false}
          />
          <Text style={styles.fieldLabel}>Keep open</Text>
          <View style={styles.tunnelTtlChoices}>
            {[
              { label: "5 min", value: "300" },
              { label: "15 min", value: "900" },
              { label: "1 hour", value: "3600" },
            ].map((choice) => (
              <Pressable
                key={choice.value}
                onPress={() => {
                  setTtl(choice.value);
                }}
                style={[styles.tunnelTtlChip, ttl === choice.value && styles.tunnelTtlChipSelected]}
              >
                <Text style={styles.composerContextText}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Tunnel TTL"
            keyboardType="number-pad"
            onChangeText={setTtl}
            style={styles.fieldInput}
            value={ttl}
          />
          {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
          <Pressable
            accessibilityLabel="Open localhost tunnel"
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void create()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{loading ? "Opening…" : "Open preview"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.previewSetup}>
          <Ionicons
            color={colors.green}
            name="checkmark-circle-outline"
            size={iconSize.illustration}
          />
          <Text style={styles.sheetTitle}>Localhost tunnel is ready</Text>
          <Text style={styles.menuNotice}>
            The browser opens as its own workspace and keeps this tunnel available in the
            background.
          </Text>
          {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
          <Pressable
            accessibilityLabel="Open localhost preview in browser"
            accessibilityRole="button"
            disabled={onOpenBrowser === undefined}
            onPress={() => {
              onOpenBrowser?.("Localhost preview", tunnel.url, {
                Authorization: tunnel.authorization,
              });
            }}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Open browser</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Close localhost tunnel"
            accessibilityRole="button"
            disabled={loading}
            onPress={close}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>{loading ? "Closing…" : "Close tunnel"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
  return visible ? content : null;
}

function openCreatedTunnel(
  openBrowser:
    | ((title: string, url: string, headers?: Readonly<Record<string, string>>) => void)
    | undefined,
  tunnel: TunnelValue,
): void {
  if (openBrowser === undefined) {
    return;
  }
  openBrowser("Localhost preview", tunnel.url, {
    Authorization: tunnel.authorization,
  });
}

export function localhostTargetPort(rawTarget: string): number {
  const target = rawTarget.trim();
  if (/^\d+$/u.test(target)) {
    const port = Number(target);
    if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) {
      return port;
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(target.includes("://") ? target : `http://${target}`);
  } catch {
    throw new Error("Use localhost:3000 or paste a localhost URL");
  }
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname) || parsed.port === "") {
    throw new Error("Only an explicit localhost port can be opened");
  }
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }
  return port;
}

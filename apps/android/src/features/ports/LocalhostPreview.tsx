import type { TunnelValue } from "../../data/workspace-resource-database";
/** V1 LocalhostPreview owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { type TunnelRow } from "../../data/workspace-resource-database";
import { colors, iconSize } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { InternalBrowser } from "./browser/InternalBrowser";
import { styles } from "./LocalhostPreview.styles";

export function LocalhostPreview({
  visible,
  onClose,
  onCreate,
  onRevoke,
  resource,
  embedded = false,
}: {
  visible: boolean;
  onClose(): void;
  onCreate?(port: number, ttlSeconds: number): Promise<TunnelValue>;
  onRevoke?(tunnelId: string): Promise<void>;
  resource: TunnelRow | null;
  embedded?: boolean;
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
    if (active !== null) void onRevoke?.(active.id).finally(onClose);
    else onClose();
  };
  const create = async () => {
    if (onCreate === undefined) return;
    setError(null);
    try {
      await onCreate(localhostTargetPort(target), Number(ttl));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open localhost preview");
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
            <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
          </Pressable>
          <View style={styles.previewIdentity}>
            <Text numberOfLines={1} style={styles.conversationTitle}>
              Localhost preview
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.conversationSubtitle}>
              Explicit server-scoped tunnel
            </Text>
          </View>
          {tunnel !== null && (
            <View style={styles.livePill}>
              <Text style={styles.livePillText}>● LIVE</Text>
            </View>
          )}
        </View>
      )}
      {tunnel === null ? (
        <View style={styles.previewSetup}>
          <Ionicons name="globe-outline" size={iconSize.illustration} color={colors.accent} />
          <Text style={styles.sheetTitle}>Open a bounded localhost tunnel</Text>
          <Text style={styles.menuNotice}>
            Only 127.0.0.1 on the selected Codex server is reachable. The tunnel expires
            automatically.
          </Text>
          <Text style={styles.fieldLabel}>Local service</Text>
          <TextInput
            voiceInput={false}
            accessibilityLabel="Local service"
            autoCapitalize="none"
            autoCorrect={false}
            value={target}
            onChangeText={setTarget}
            placeholder="localhost:3000"
            placeholderTextColor={colors.textDim}
            style={styles.fieldInput}
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
                onPress={() => setTtl(choice.value)}
                style={[styles.tunnelTtlChip, ttl === choice.value && styles.tunnelTtlChipSelected]}
              >
                <Text style={styles.composerContextText}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Tunnel TTL"
            keyboardType="number-pad"
            value={ttl}
            onChangeText={setTtl}
            style={styles.fieldInput}
          />
          {effectiveError !== null && <Text style={styles.errorText}>{effectiveError}</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open localhost tunnel"
            disabled={loading}
            onPress={() => void create()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{loading ? "Opening…" : "Open preview"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.flex}>
          {error !== null && <Text style={styles.previewError}>{error}</Text>}
          <InternalBrowser
            url={tunnel.url}
            headers={{ Authorization: tunnel.authorization }}
            {...(!embedded
              ? {
                  header: {
                    title: "Localhost preview",
                    closeLabel: "Close localhost preview",
                    status: "LIVE",
                    onClose: close,
                  },
                }
              : {})}
            originWhitelist={[new URL(tunnel.url).origin]}
            onHttpError={(statusCode) =>
              setError(
                statusCode === 502
                  ? "Nothing is listening on that local service"
                  : `Preview returned HTTP ${statusCode}`,
              )
            }
            onError={setError}
          />
        </View>
      )}
    </View>
  );
  return visible ? content : null;
}

export function localhostTargetPort(rawTarget: string): number {
  const target = rawTarget.trim();
  if (/^\d+$/u.test(target)) {
    const port = Number(target);
    if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) return port;
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
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("Port must be between 1 and 65535");
  return port;
}

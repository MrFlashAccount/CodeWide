import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useSyncExternalStore, type ComponentProps, type ComponentType } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type {
  PairingPreview,
  PairSavedServerInput,
} from "../../application/ports/savedServerRepository";
import { useV2Runtime } from "../../V2Application";
import {
  PresentationSheetScrollView,
  PresentationSheetView,
  type PresentationSheetContentProps,
} from "../../presentation/surfaces/PresentationSheetView";
import {
  PresentationText as Text,
  PresentationTextInput as TextInput,
} from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import type { SavedServerId } from "../../domain/ids";
import { VoiceTextInput } from "../conversation/VoiceTextInput";
import { serverDestination } from "../navigation/routeDestinations";

type PairingMode = "choose" | "manual" | "review" | "success";

export interface PairingScannerProps {
  onClose(): void;
  onScan(raw: string): string | null;
}

interface NewSavedServerScreenProps {
  initialError: string | null;
  initialPairing: PairingPreview | null;
  readClipboard(): Promise<string>;
  Scanner: ComponentType<PairingScannerProps>;
}

export function NewSavedServerScreen(props: NewSavedServerScreenProps): React.JSX.Element {
  const { initialError, initialPairing, readClipboard, Scanner } = props;
  const runtime = useV2Runtime();
  const connectionStatuses = useSyncExternalStore(
    runtime.connectionStatuses.subscribe,
    runtime.connectionStatuses.snapshot,
    runtime.connectionStatuses.snapshot,
  );
  const [mode, setMode] = useState<PairingMode>(initialPairing === null ? "choose" : "review");
  const [scannerVisible, setScannerVisible] = useState(false);
  const [displayName, setDisplayName] = useState(initialPairing?.displayName ?? "");
  const [emoji, setEmoji] = useState(initialPairing?.emoji ?? "🖥️");
  const [endpoint, setEndpoint] = useState(initialPairing?.endpoint ?? "");
  const [pairingToken, setPairingToken] = useState(initialPairing?.pairingToken ?? "");
  const [tlsPinSha256, setTlsPinSha256] = useState(initialPairing?.tlsPinSha256 ?? "");
  const [expiresAt, setExpiresAt] = useState<number | null>(initialPairing?.expiresAt ?? null);
  const [error, setError] = useState<string | null>(initialError);
  const [saving, setSaving] = useState(false);

  const close = useEvent(() => {
    if (!saving) router.back();
  });
  const openChoose = useEvent(() => {
    setError(null);
    setMode("choose");
  });
  const openManual = useEvent(() => {
    setError(null);
    setMode("manual");
  });
  const closeScanner = useEvent(() => setScannerVisible(false));
  const openScanner = useEvent(() => setScannerVisible(true));
  const consumeCode = useEvent((raw: string): string | null => {
    try {
      const pairing = runtime.parseSavedServerLink(raw);
      applyPairingPreview(pairing, {
        setDisplayName,
        setEmoji,
        setEndpoint,
        setExpiresAt,
        setPairingToken,
        setTlsPinSha256,
      });
      setError(null);
      setMode("review");
      return null;
    } catch (cause) {
      const message = pairingError(cause);
      setError(message);
      return message;
    }
  });
  const pasteCode = useEvent(async () => {
    setError(null);
    const value = await readClipboard();
    if (value.trim() === "") {
      setError("Clipboard is empty. Copy the connection link from your host first.");
      return;
    }
    consumeCode(value);
  });
  const save = useEvent(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const id = await runtime.pairSavedServer({
        displayName,
        emoji,
        endpoint,
        pairingToken,
        tlsPinSha256,
      });
      setMode("success");
      await delay(650);
      router.replace(serverDestination(id));
    } catch (cause) {
      setError(pairingError(cause));
      setSaving(false);
    }
  });
  const onSheetOpenChange = useEvent((open: boolean) => {
    if (!open) close();
  });

  if (scannerVisible) {
    return <Scanner onClose={closeScanner} onScan={consumeCode} />;
  }

  const endpointLabel = pairingEndpointLabel(endpoint);
  const minutesLeft =
    expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - runtime.now()) / 60_000));
  let voiceAudience: SavedServerId | undefined;
  for (const [savedServerId, status] of connectionStatuses.value) {
    if (status.state !== "connected") continue;
    voiceAudience = savedServerId;
    break;
  }
  return (
    <PresentationSheetView
      contentProps={PAIRING_SHEET_PROPS}
      isOpen
      onOpenChange={onSheetOpenChange}
    >
      <PresentationSheetScrollView
        contentContainerStyle={styles.connectionSheetContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.connectionSheetScroll}
      >
        <View style={styles.pairingHeader}>
          {mode === "choose" || mode === "success" ? (
            <View style={styles.pairingBack} />
          ) : (
            <Pressable
              accessibilityLabel="Back to connection methods"
              hitSlop={8}
              onPress={openChoose}
              style={styles.pairingBack}
            >
              <Ionicons color={colors.text} name="chevron-back" size={21} />
            </Pressable>
          )}
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.pairingHeaderTitle}>
            {mode === "review"
              ? "Ready to connect"
              : mode === "manual"
                ? "Manual setup"
                : mode === "success"
                  ? "Connected"
                  : "Connect a server"}
          </Text>
          <Pressable
            accessibilityLabel="Close server pairing"
            disabled={saving}
            hitSlop={8}
            onPress={close}
            style={styles.pairingBack}
          >
            <Ionicons color={colors.textMuted} name="close" size={21} />
          </Pressable>
        </View>

        {mode === "choose" ? (
          <ChoosePairingMethod
            error={error}
            onManual={openManual}
            onPaste={pasteCode}
            onScan={openScanner}
          />
        ) : null}
        {mode === "review" ? (
          <ReviewPairing
            displayName={displayName}
            emoji={emoji}
            endpointLabel={endpointLabel}
            error={error}
            minutesLeft={minutesLeft}
            onDisplayNameChange={setDisplayName}
            onEdit={openManual}
            onEmojiChange={setEmoji}
            onSave={save}
            saving={saving}
            voiceAudience={voiceAudience}
          />
        ) : null}
        {mode === "manual" ? (
          <ManualPairing
            displayName={displayName}
            emoji={emoji}
            endpoint={endpoint}
            error={error}
            onDisplayNameChange={setDisplayName}
            onEmojiChange={setEmoji}
            onEndpointChange={setEndpoint}
            onPairingTokenChange={setPairingToken}
            onSave={save}
            onTlsPinChange={setTlsPinSha256}
            pairingToken={pairingToken}
            saving={saving}
            tlsPinSha256={tlsPinSha256}
            voiceAudience={voiceAudience}
          />
        ) : null}
        {mode === "success" ? <SuccessfulPairing displayName={displayName} emoji={emoji} /> : null}
      </PresentationSheetScrollView>
    </PresentationSheetView>
  );
}

interface SuccessfulPairingProps {
  displayName: string;
  emoji: string;
}

function SuccessfulPairing(props: SuccessfulPairingProps): React.JSX.Element {
  const { displayName, emoji } = props;
  return (
    <View style={styles.pairingSuccess}>
      <View style={styles.pairingSuccessIcon}>
        <Ionicons color={colors.onPrimary} name="checkmark" size={34} />
      </View>
      <Text ellipsizeMode="tail" numberOfLines={2} style={styles.pairingSuccessTitle}>
        {emoji} {displayName}
      </Text>
      <Text style={styles.pairingHint}>Connected. Syncing your threads now.</Text>
    </View>
  );
}

async function delay(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

interface PairingPreviewSetters {
  setDisplayName(value: string): void;
  setEmoji(value: string): void;
  setEndpoint(value: string): void;
  setExpiresAt(value: number): void;
  setPairingToken(value: string): void;
  setTlsPinSha256(value: string): void;
}

function applyPairingPreview(pairing: PairingPreview, setters: PairingPreviewSetters): void {
  setters.setDisplayName(pairing.displayName);
  setters.setEmoji(pairing.emoji);
  setters.setEndpoint(pairing.endpoint);
  setters.setExpiresAt(pairing.expiresAt);
  setters.setPairingToken(pairing.pairingToken);
  setters.setTlsPinSha256(pairing.tlsPinSha256);
}

interface ChoosePairingMethodProps {
  error: string | null;
  onManual(): void;
  onPaste(): Promise<void>;
  onScan(): void;
}

function ChoosePairingMethod(props: ChoosePairingMethodProps): React.JSX.Element {
  const { error, onManual, onPaste, onScan } = props;
  const paste = useEvent(() => {
    onPaste().catch(() => undefined);
  });
  return (
    <View style={styles.pairingBody}>
      <View style={styles.pairingHeroIcon}>
        <Ionicons color={colors.primary} name="link" size={28} />
      </View>
      <Text style={styles.pairingLead}>
        Connect this phone to Codex running on another machine.
      </Text>
      <Text style={styles.pairingHint}>
        On the host, run <Text style={styles.pairingCode}>codewide-host pair</Text>. Then scan or
        paste the one-time link.
      </Text>
      <View style={styles.pairingActionStack}>
        <Pressable
          accessibilityLabel="Scan pairing QR"
          accessibilityRole="button"
          onPress={onScan}
          style={styles.pairingPrimaryAction}
        >
          <Ionicons color={colors.onPrimary} name="qr-code-outline" size={22} />
          <Text style={styles.pairingPrimaryText}>Scan QR code</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Paste connection link"
          accessibilityRole="button"
          onPress={paste}
          style={styles.pairingSecondaryAction}
        >
          <Ionicons color={colors.text} name="clipboard-outline" size={21} />
          <Text style={styles.pairingSecondaryText}>Paste connection link</Text>
        </Pressable>
      </View>
      {error === null ? null : <PairingError message={error} />}
      <Pressable
        accessibilityLabel="Open manual server setup"
        accessibilityRole="button"
        onPress={onManual}
        style={styles.pairingTextAction}
      >
        <Text style={styles.pairingTextActionLabel}>Advanced manual setup</Text>
        <Ionicons color={colors.textMuted} name="chevron-forward" size={17} />
      </Pressable>
      <View style={styles.pairingSafety}>
        <Ionicons color={colors.green} name="shield-checkmark-outline" size={17} />
        <Text style={styles.pairingSafetyText}>
          One-time code · device-bound credentials · revocable access
        </Text>
      </View>
    </View>
  );
}

interface ReviewPairingProps {
  displayName: string;
  emoji: string;
  endpointLabel: string;
  error: string | null;
  minutesLeft: number | null;
  onDisplayNameChange(value: string): void;
  onEdit(): void;
  onEmojiChange(value: string): void;
  onSave(): Promise<void>;
  saving: boolean;
  voiceAudience: SavedServerId | undefined;
}

function ReviewPairing(props: ReviewPairingProps): React.JSX.Element {
  const {
    displayName,
    emoji,
    endpointLabel,
    error,
    minutesLeft,
    onDisplayNameChange,
    onEdit,
    onEmojiChange,
    onSave,
    saving,
    voiceAudience,
  } = props;
  return (
    <View style={styles.pairingBody}>
      <View style={styles.pairingReviewCard}>
        <View style={styles.pairingIdentityRow}>
          <TextInput
            accessibilityLabel="Server emoji"
            onChangeText={onEmojiChange}
            style={styles.pairingEmojiInput}
            value={emoji}
          />
          <ServerNameInput
            accessibilityLabel="Server name"
            onChangeText={onDisplayNameChange}
            selectTextOnFocus
            style={styles.pairingNameInput}
            value={displayName}
            voiceAudience={voiceAudience}
          />
        </View>
        <View style={styles.pairingServerMeta}>
          <Ionicons color={colors.green} name="lock-closed-outline" size={16} />
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.pairingEndpoint}>
            {endpointLabel}
          </Text>
        </View>
        <View style={styles.pairingServerMeta}>
          <Ionicons color={colors.textMuted} name="time-outline" size={16} />
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.pairingMetaText}>
            {minutesLeft === null ? "One-time connection" : `Code expires in ${minutesLeft} min`}
          </Text>
        </View>
      </View>
      {error === null ? null : <PairingError message={error} />}
      <ConnectButton
        accessibilityLabel="Connect server"
        disabled={false}
        onPress={onSave}
        saving={saving}
      />
      <Pressable
        accessibilityLabel="Edit connection details"
        accessibilityRole="button"
        disabled={saving}
        onPress={onEdit}
        style={styles.pairingTextAction}
      >
        <Text style={styles.pairingTextActionLabel}>Edit details</Text>
        <Ionicons color={colors.textMuted} name="options-outline" size={17} />
      </Pressable>
    </View>
  );
}

interface ManualPairingProps extends PairSavedServerInput {
  error: string | null;
  onDisplayNameChange(value: string): void;
  onEmojiChange(value: string): void;
  onEndpointChange(value: string): void;
  onPairingTokenChange(value: string): void;
  onSave(): Promise<void>;
  onTlsPinChange(value: string): void;
  saving: boolean;
  voiceAudience: SavedServerId | undefined;
}

function ManualPairing(props: ManualPairingProps): React.JSX.Element {
  return (
    <View style={styles.pairingBody}>
      <Text style={styles.pairingHint}>
        Use this only when QR and connection links are unavailable.
      </Text>
      <View style={styles.pairingIdentityFields}>
        <TextInput
          accessibilityLabel="Server emoji"
          onChangeText={props.onEmojiChange}
          style={styles.pairingEmojiInput}
          value={props.emoji}
        />
        <ServerNameInput
          accessibilityLabel="Server name"
          onChangeText={props.onDisplayNameChange}
          placeholder="Home workstation"
          placeholderTextColor={colors.textDim}
          style={[styles.fieldInput, styles.flex]}
          value={props.displayName}
          voiceAudience={props.voiceAudience}
        />
      </View>
      <Text style={styles.fieldLabel}>Secure endpoint</Text>
      <TextInput
        accessibilityLabel="Server endpoint"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={props.onEndpointChange}
        placeholder="wss://host.example/v1/sync"
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
        value={props.endpoint}
      />
      <Text style={styles.fieldLabel}>One-time pairing token</Text>
      <TextInput
        accessibilityLabel="One-time pairing token"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={props.onPairingTokenChange}
        placeholder="Paste token"
        placeholderTextColor={colors.textDim}
        secureTextEntry
        style={styles.fieldInput}
        value={props.pairingToken}
      />
      <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
      <TextInput
        accessibilityLabel="TLS certificate pin"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={props.onTlsPinChange}
        placeholder="sha256/base64…"
        placeholderTextColor={colors.textDim}
        style={styles.fieldInput}
        value={props.tlsPinSha256}
      />
      {props.error === null ? null : <PairingError message={props.error} />}
      <ConnectButton
        accessibilityLabel="Connect server manually"
        disabled={
          props.endpoint.trim() === "" ||
          props.pairingToken.trim() === "" ||
          props.tlsPinSha256.trim() === ""
        }
        onPress={props.onSave}
        saving={props.saving}
      />
    </View>
  );
}

interface ServerNameInputProps extends ComponentProps<typeof TextInput> {
  value: string;
  voiceAudience: SavedServerId | undefined;
}

function ServerNameInput(props: ServerNameInputProps): React.JSX.Element {
  const { voiceAudience, ...inputProps } = props;
  if (voiceAudience === undefined) return <TextInput {...inputProps} />;
  return (
    <VoiceTextInput
      {...inputProps}
      audience={voiceAudience}
      scope={{ id: "server-name:new", kind: "generic" }}
      thread={null}
    />
  );
}

interface ConnectButtonProps {
  accessibilityLabel: string;
  disabled: boolean;
  onPress(): Promise<void>;
  saving: boolean;
}

function ConnectButton(props: ConnectButtonProps): React.JSX.Element {
  const { accessibilityLabel, disabled, onPress, saving } = props;
  const press = useEvent(() => {
    onPress().catch(() => undefined);
  });
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={saving || disabled}
      onPress={press}
      style={[styles.pairingPrimaryAction, (saving || disabled) && styles.disabled]}
    >
      {saving ? null : <Ionicons color={colors.onPrimary} name="link" size={21} />}
      {saving ? (
        <ShimmerText style={styles.pairingPrimaryText} text="Securing this device…" />
      ) : (
        <Text style={styles.pairingPrimaryText}>Connect</Text>
      )}
    </Pressable>
  );
}

interface PairingErrorProps {
  message: string;
}

function PairingError(props: PairingErrorProps): React.JSX.Element {
  const { message } = props;
  return (
    <View style={styles.pairingError}>
      <Ionicons color={colors.red} name="alert-circle-outline" size={18} />
      <Text selectable style={[styles.errorText, styles.flex]}>
        {message}
      </Text>
    </View>
  );
}

function pairingEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.port === "" ? url.hostname : `${url.hostname}:${url.port}`;
  } catch {
    return endpoint.trim() === "" ? "Secure remote host" : endpoint.trim();
  }
}

function pairingError(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "Could not pair this server. Check that the one-time link is valid and unexpired.";
}

const PAIRING_SHEET_PROPS: PresentationSheetContentProps = {
  contentContainerClassName: "h-full",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};

const styles = StyleSheet.create({
  connectionSheetScroll: { width: "100%" },
  connectionSheetContent: { gap: spacing.xs },
  pairingHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xxs,
  },
  pairingHeaderTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    ...typeScale.heading,
    textAlign: "center",
  },
  pairingBack: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  pairingBody: { gap: spacing.md, paddingBottom: spacing.optical },
  pairingHeroIcon: {
    width: 54,
    height: 54,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: colors.primaryContainer,
  },
  pairingLead: {
    color: colors.text,
    ...typeScale.heading,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  pairingHint: {
    color: colors.textMuted,
    ...typeScale.body,
    textAlign: "center",
    paddingHorizontal: spacing.xs,
  },
  pairingCode: {
    color: colors.text,
    fontFamily: typeScale.code.fontFamily,
  },
  pairingActionStack: { gap: spacing.xs, marginTop: spacing.optical },
  pairingPrimaryAction: {
    minHeight: touchTarget,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pairingPrimaryText: {
    color: colors.onPrimary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  pairingSecondaryAction: {
    minHeight: touchTarget,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pairingSecondaryText: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  pairingTextAction: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  pairingTextActionLabel: {
    color: colors.textMuted,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  pairingSafety: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingTop: spacing.xxs,
  },
  pairingSafetyText: { color: colors.textDim, ...typeScale.caption, flexShrink: 1 },
  pairingSuccess: {
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xl,
  },
  pairingSuccessIcon: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 32,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  pairingSuccessTitle: {
    color: colors.text,
    ...typeScale.heading,
    paddingHorizontal: spacing.md,
    textAlign: "center",
  },
  pairingError: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.medium,
    backgroundColor: colors.errorContainer,
  },
  pairingReviewCard: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceContainerLow,
  },
  pairingIdentityRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pairingIdentityFields: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pairingEmojiInput: {
    width: 52,
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.xs,
    ...typeScale.heading,
    textAlign: "center",
  },
  pairingNameInput: {
    flex: 1,
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.sm,
    ...typeScale.title,
  },
  pairingServerMeta: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  pairingEndpoint: { color: colors.textMuted, ...typeScale.label, flex: 1 },
  pairingMetaText: { flex: 1, minWidth: 0, color: colors.textMuted, ...typeScale.label },
  fieldLabel: { color: colors.textMuted, ...typeScale.label, marginTop: spacing.xxs },
  fieldInput: {
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    ...typeScale.body,
  },
  errorText: { color: colors.red, ...typeScale.body },
  disabled: { opacity: 0.45 },
  flex: { flex: 1 },
});

import type { ConnectionSheetProps, ConnectionSheetSessionProps } from "./connectionSheetContract";
import { PairingChoose } from "./PairingChoose";
import { PairingManual } from "./PairingManual";
import { PairingReview } from "./PairingReview";
import { usePairingSession } from "./pairingSession";
import { PairingSuccess } from "./PairingSuccess";
/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ConnectionSheet.styles";

export function ConnectionSheet({
  visible,
  localReady,
  localError,
  onRetryStartup,
  onClose,
  onSave,
  initialCode,
}: ConnectionSheetProps) {
  const [saving, setSaving] = useState(false);
  const close = () => {
    if (!saving) onClose();
  };
  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      contentProps={{
        dismissLabel: "Close server pairing",
        enablePanDownToClose: !saving,
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      <ConnectionSheetSession
        visible={visible}
        localReady={localReady}
        localError={localError}
        onRetryStartup={onRetryStartup}
        onClose={close}
        onSave={onSave}
        initialCode={initialCode}
        saving={saving}
        setSaving={setSaving}
      />
    </AppSheet>
  );
}

export function ConnectionSheetSession(props: ConnectionSheetSessionProps) {
  const { localError, localReady, onRetryStartup, saving } = props;
  const {
    mode,
    setMode,
    displayName,
    setDisplayName,
    emoji,
    setEmoji,
    endpoint,
    setEndpoint,
    token,
    setToken,
    tlsPinSha256,
    setTlsPinSha256,
    error,
    setError,
    pasteCode,
    openPairingScanner,
    save,
    endpointLabel,
    minutesLeft,
  } = usePairingSession(props);
  return (
    <AppSheetScrollView
      style={styles.connectionSheetScroll}
      contentContainerStyle={styles.connectionSheetContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pairingHeader}>
        {mode !== "choose" && mode !== "success" ? (
          <Pressable
            accessibilityLabel="Back to connection methods"
            hitSlop={8}
            onPress={() => {
              setMode("choose");
              setError(null);
            }}
            style={styles.pairingBack}
          >
            <Ionicons name="chevron-back" size={iconSize.action} color={colors.text} />
          </Pressable>
        ) : null}
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.pairingHeaderTitle}>
          {mode === "review"
            ? "Ready to connect"
            : mode === "manual"
              ? "Manual setup"
              : mode === "success"
                ? "Connected"
                : "Connect a server"}
        </Text>
      </View>

      {mode === "choose" && (
        <PairingChoose
          error={error}
          openPairingScanner={openPairingScanner}
          pasteCode={pasteCode}
          setMode={setMode}
          setError={setError}
        />
      )}

      {mode === "review" && (
        <PairingReview
          emoji={emoji}
          displayName={displayName}
          setEmoji={setEmoji}
          setDisplayName={setDisplayName}
          endpointLabel={endpointLabel}
          minutesLeft={minutesLeft}
          error={error}
          localError={localError}
          onRetryStartup={onRetryStartup}
          saving={saving}
          localReady={localReady}
          save={save}
          setMode={setMode}
        />
      )}

      {mode === "manual" && (
        <PairingManual
          emoji={emoji}
          displayName={displayName}
          setEmoji={setEmoji}
          setDisplayName={setDisplayName}
          endpoint={endpoint}
          setEndpoint={setEndpoint}
          token={token}
          setToken={setToken}
          tlsPinSha256={tlsPinSha256}
          setTlsPinSha256={setTlsPinSha256}
          error={error}
          localError={localError}
          onRetryStartup={onRetryStartup}
          saving={saving}
          localReady={localReady}
          save={save}
        />
      )}

      {mode === "success" && <PairingSuccess emoji={emoji} displayName={displayName} />}
    </AppSheetScrollView>
  );
}

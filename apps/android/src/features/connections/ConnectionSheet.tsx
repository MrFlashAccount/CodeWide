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
  initialCode,
  localError,
  localReady,
  onClose,
  onRetryStartup,
  onSave,
  visible,
}: ConnectionSheetProps) {
  const [saving, setSaving] = useState(false);
  const close = () => {
    if (!saving) {
      onClose();
    }
  };
  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        dismissLabel: "Close server pairing",
        enableDynamicSizing: false,
        enableOverDrag: false,
        enablePanDownToClose: !saving,
        index: 0,
        snapPoints: ["55%", "90%"],
      }}
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <ConnectionSheetSession
        initialCode={initialCode}
        localError={localError}
        localReady={localReady}
        onClose={close}
        onRetryStartup={onRetryStartup}
        onSave={onSave}
        saving={saving}
        setSaving={setSaving}
        visible={visible}
      />
    </AppSheet>
  );
}

export function ConnectionSheetSession(props: ConnectionSheetSessionProps) {
  const { localError, localReady, onRetryStartup, saving } = props;
  const {
    displayName,
    emoji,
    endpoint,
    endpointLabel,
    error,
    minutesLeft,
    mode,
    openPairingScanner,
    pasteCode,
    save,
    setDisplayName,
    setEmoji,
    setEndpoint,
    setError,
    setMode,
    setTlsPinSha256,
    setToken,
    tlsPinSha256,
    token,
  } = usePairingSession(props);
  return (
    <AppSheetScrollView
      contentContainerStyle={styles.connectionSheetContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.connectionSheetScroll}
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
            <Ionicons color={colors.text} name="chevron-back" size={iconSize.action} />
          </Pressable>
        ) : null}
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.pairingHeaderTitle}>
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
          setError={setError}
          setMode={setMode}
        />
      )}

      {mode === "review" && (
        <PairingReview
          displayName={displayName}
          emoji={emoji}
          endpointLabel={endpointLabel}
          error={error}
          localError={localError}
          localReady={localReady}
          minutesLeft={minutesLeft}
          onRetryStartup={onRetryStartup}
          save={save}
          saving={saving}
          setDisplayName={setDisplayName}
          setEmoji={setEmoji}
          setMode={setMode}
        />
      )}

      {mode === "manual" && (
        <PairingManual
          displayName={displayName}
          emoji={emoji}
          endpoint={endpoint}
          error={error}
          localError={localError}
          localReady={localReady}
          onRetryStartup={onRetryStartup}
          save={save}
          saving={saving}
          setDisplayName={setDisplayName}
          setEmoji={setEmoji}
          setEndpoint={setEndpoint}
          setTlsPinSha256={setTlsPinSha256}
          setToken={setToken}
          tlsPinSha256={tlsPinSha256}
          token={token}
        />
      )}

      {mode === "success" && <PairingSuccess displayName={displayName} emoji={emoji} />}
    </AppSheetScrollView>
  );
}

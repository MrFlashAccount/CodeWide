/** V1 PairingQrScanner owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import type { useCameraPermissions } from "expo-camera";
import { CameraView } from "expo-camera";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./PairingQrScanner.styles";

export function PairingQrScanner({
  initialPermission,
  onClose,
  onScan,
  requestPermission,
}: {
  initialPermission: ReturnType<typeof useCameraPermissions>[0];
  onClose: () => void;
  onScan: (raw: string) => string | null;
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
}) {
  const [permission, setPermission] = useState(initialPermission);
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.scannerRoot, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.scannerHeader}>
        <Text style={styles.sheetTitle}>Scan host pairing QR</Text>
        <Pressable
          accessibilityLabel="Close QR scanner"
          onPress={onClose}
          style={styles.headerIcon}
        >
          <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
        </Pressable>
      </View>
      {permission === null ? (
        <View style={styles.emptyConversation}>
          <Text style={styles.emptyText}>Starting camera…</Text>
        </View>
      ) : permission.granted ? (
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          facing="back"
          onBarcodeScanned={
            scanned
              ? undefined
              : ({ data }) => {
                  setScanned(true);
                  const message = onScan(data);
                  if (message !== null) {
                    setScanError(message);
                    setTimeout(() => {
                      setScanned(false);
                    }, 900);
                  }
                }
          }
          style={styles.scannerCamera}
        >
          <View style={styles.scannerFrame} />
          {scanError !== null && (
            <View style={styles.scannerError}>
              <Text style={styles.errorText}>{scanError}</Text>
            </View>
          )}
        </CameraView>
      ) : (
        <View style={styles.emptyConversation}>
          <Text style={styles.emptyText}>
            Camera permission is required to scan the one-time pairing code.
          </Text>
          <Pressable
            onPress={() =>
              void (permission.canAskAgain
                ? requestPermission().then(setPermission)
                : Linking.openSettings())
            }
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>
              {permission.canAskAgain ? "Allow camera" : "Open settings"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

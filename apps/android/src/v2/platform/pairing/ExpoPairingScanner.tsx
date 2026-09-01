import { Ionicons } from "@expo/vector-icons";
import {
  CameraView,
  type BarcodeScanningResult,
  type CameraViewProps,
  useCameraPermissions,
} from "expo-camera";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PairingScannerProps } from "../../features/settings/NewSavedServerScreen";
import { PresentationText as Text } from "../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";

export function ExpoPairingScanner(props: PairingScannerProps): React.JSX.Element {
  const { onClose, onScan } = props;
  const [permission, requestCameraPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const resetScan = useEvent(() => setScanned(false));
  const scan = useEvent((result: BarcodeScanningResult) => {
    setScanned(true);
    const message = onScan(result.data);
    if (message !== null) {
      setScanError(message);
      setTimeout(resetScan, 900);
    }
  });
  const requestPermission = useEvent(async () => {
    await requestCameraPermission();
  });
  const openSettings = useEvent(async () => {
    await Linking.openSettings();
  });
  const resolvePermission = permission?.canAskAgain === true ? requestPermission : openSettings;
  const pressPermission = useEvent(() => {
    resolvePermission().catch(() => undefined);
  });

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Scan host pairing QR</Text>
        <Pressable
          accessibilityLabel="Close QR scanner"
          onPress={onClose}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="close" size={23} />
        </Pressable>
      </View>
      {permission === null ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Starting camera…</Text>
        </View>
      ) : permission.granted ? (
        <CameraView
          barcodeScannerSettings={BARCODE_SETTINGS}
          facing="back"
          onBarcodeScanned={scanned ? undefined : scan}
          style={styles.camera}
        >
          <View style={styles.frame} />
          {scanError === null ? null : (
            <View style={styles.scanError}>
              <Text style={styles.errorText}>{scanError}</Text>
            </View>
          )}
        </CameraView>
      ) : (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            Camera permission is required to scan the one-time pairing code.
          </Text>
          <Pressable onPress={pressPermission} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>
              {permission.canAskAgain ? "Allow camera" : "Open settings"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const BARCODE_SETTINGS: NonNullable<CameraViewProps["barcodeScannerSettings"]> = {
  barcodeTypes: ["qr"],
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
  },
  title: { flex: 1, color: colors.text, ...typeScale.heading },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  emptyText: { color: colors.textMuted, ...typeScale.body, textAlign: "center" },
  camera: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: {
    width: 248,
    height: 248,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: colors.text,
    backgroundColor: "transparent",
  },
  scanError: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    padding: spacing.sm,
    borderRadius: radii.medium,
    backgroundColor: colors.errorContainer,
  },
  errorText: { color: colors.red, ...typeScale.body, textAlign: "center" },
  primaryButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
});

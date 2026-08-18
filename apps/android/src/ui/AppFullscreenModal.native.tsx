import { PortalHost } from "heroui-native/portal";
import { useId, useState, type ReactNode } from "react";
import { Modal, StyleSheet } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors } from "../theme";
import { FullscreenWindowReadyProvider } from "./FullscreenWindowReady";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

const FULLSCREEN_SAFE_AREA_EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
export function AppFullscreenModal({
  isOpen,
  onClose,
  onShow,
  children,
}: {
  isOpen: boolean;
  onClose(): void;
  onShow?(): void;
  children: ReactNode;
}) {
  const portalHostName = `fullscreen-modal-${useId()}`;
  const [windowReady, setWindowReady] = useState(false);
  if (!isOpen) return null;

  return (
    <RecoverableRenderBoundary scope="dialog" label="Fullscreen modal" onDismiss={onClose}>
      <Modal
        visible
        hardwareAccelerated
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
        onShow={() => {
          setWindowReady(true);
          onShow?.();
        }}
        onRequestClose={onClose}
      >
        <SafeAreaView
          testID="fullscreen-modal-safe-area"
          edges={FULLSCREEN_SAFE_AREA_EDGES}
          style={styles.root}
        >
          <FullscreenWindowReadyProvider ready={windowReady}>
            <OverlaySurfaceProvider surface="fullscreen-modal" portalHostName={portalHostName}>
              {children}
              <PortalHost name={portalHostName} />
            </OverlaySurfaceProvider>
          </FullscreenWindowReadyProvider>
        </SafeAreaView>
      </Modal>
    </RecoverableRenderBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: colors.background,
  },
});

import { useState, type ReactNode } from "react";
import { Modal, StyleSheet } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors } from "../theme";
import { FullscreenWindowReadyProvider } from "./FullscreenWindowReady";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

const FULLSCREEN_SAFE_AREA_EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
export function AppFullscreenModal({
  children,
  isOpen,
  onClose,
  onShow,
}: {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  onShow?: () => void;
}) {
  if (!isOpen) {
    return null;
  }
  return (
    <VisibleFullscreenModal onClose={onClose} {...(onShow === undefined ? {} : { onShow })}>
      {children}
    </VisibleFullscreenModal>
  );
}

function VisibleFullscreenModal({
  children,
  onClose,
  onShow,
}: {
  children: ReactNode;
  onClose: () => void;
  onShow?: () => void;
}) {
  const [windowReady, setWindowReady] = useState(false);

  return (
    <RecoverableRenderBoundary label="Fullscreen modal" onDismiss={onClose} scope="dialog">
      <Modal
        animationType="slide"
        hardwareAccelerated
        onRequestClose={onClose}
        onShow={() => {
          setWindowReady(true);
          onShow?.();
        }}
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
        visible
      >
        <SafeAreaView
          edges={FULLSCREEN_SAFE_AREA_EDGES}
          style={styles.root}
          testID="fullscreen-modal-safe-area"
        >
          <FullscreenWindowReadyProvider ready={windowReady}>
            <OverlaySurfaceProvider surface="fullscreen-modal">{children}</OverlaySurfaceProvider>
          </FullscreenWindowReadyProvider>
        </SafeAreaView>
      </Modal>
    </RecoverableRenderBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
});

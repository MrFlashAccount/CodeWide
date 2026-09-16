import type { ReactNode } from "react";
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
    <RecoverableRenderBoundary label="Fullscreen modal" onDismiss={onClose} scope="dialog">
      <Modal
        animationType="slide"
        onRequestClose={onClose}
        onShow={onShow}
        presentationStyle="fullScreen"
        visible
      >
        <SafeAreaView
          edges={FULLSCREEN_SAFE_AREA_EDGES}
          style={styles.root}
          testID="fullscreen-modal-safe-area"
        >
          <FullscreenWindowReadyProvider ready>
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

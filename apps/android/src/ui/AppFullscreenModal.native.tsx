import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { findNodeHandle, Modal, StyleSheet } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { setNativeVoiceAuraTarget } from "../native/native-transport";
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
  const rootRef = useRef<ComponentRef<typeof SafeAreaView> | null>(null);
  const registerVoiceAuraTarget = () => {
    const reactTag = findNodeHandle(rootRef.current);
    if (reactTag !== null) {
      setNativeVoiceAuraTarget(reactTag);
    }
  };
  useEffect(
    () => () => {
      setNativeVoiceAuraTarget(null);
    },
    [],
  );

  return (
    <RecoverableRenderBoundary label="Fullscreen modal" onDismiss={onClose} scope="dialog">
      <Modal
        animationType="slide"
        hardwareAccelerated
        onRequestClose={onClose}
        onShow={() => {
          setWindowReady(true);
          requestAnimationFrame(registerVoiceAuraTarget);
          onShow?.();
        }}
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
        visible
      >
        <SafeAreaView
          collapsable={false}
          edges={FULLSCREEN_SAFE_AREA_EDGES}
          onLayout={registerVoiceAuraTarget}
          ref={rootRef}
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

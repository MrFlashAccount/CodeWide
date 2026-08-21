import { PortalHost } from "heroui-native/portal";
import { useEffect, useId, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { findNodeHandle, Modal, StyleSheet } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { setNativeVoiceAuraTarget } from "../native/native-transport";
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
  if (!isOpen) return null;
  return <VisibleFullscreenModal onClose={onClose} {...(onShow === undefined ? {} : { onShow })}>{children}</VisibleFullscreenModal>;
}

function VisibleFullscreenModal({
  onClose,
  onShow,
  children,
}: {
  onClose(): void;
  onShow?(): void;
  children: ReactNode;
}) {
  const portalHostName = `fullscreen-modal-${useId()}`;
  const [windowReady, setWindowReady] = useState(false);
  const rootRef = useRef<ComponentRef<typeof SafeAreaView> | null>(null);
  const registerVoiceAuraTarget = () => {
    const reactTag = findNodeHandle(rootRef.current);
    if (reactTag !== null) setNativeVoiceAuraTarget(reactTag);
  };
  useEffect(() => () => setNativeVoiceAuraTarget(null), []);

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
          requestAnimationFrame(registerVoiceAuraTarget);
          onShow?.();
        }}
        onRequestClose={onClose}
      >
        <SafeAreaView
          ref={rootRef}
          collapsable={false}
          testID="fullscreen-modal-safe-area"
          edges={FULLSCREEN_SAFE_AREA_EDGES}
          style={styles.root}
          onLayout={registerVoiceAuraTarget}
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

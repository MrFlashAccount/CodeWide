import { BasicAlertDialog, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { background, fillMaxSize } from "@expo/ui/jetpack-compose/modifiers";
import { PortalHost } from "heroui-native/portal";
import { useEffect, useId, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  findNodeHandle,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, type Edge } from "react-native-safe-area-context";

import {
  configureNativeFullscreenWindow,
  setNativeVoiceAuraTarget,
} from "../native/native-transport";
import { useEvent } from "../react/useEvent";
import { colors } from "../theme";
import { FullscreenWindowReadyProvider } from "./FullscreenWindowReady";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

interface FullscreenModalProps {
  isOpen: boolean;
  onClose(): void;
  onShow?(): void;
  children: ReactNode;
}

const FULLSCREEN_SAFE_AREA_EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
const FULLSCREEN_MODIFIERS = [fillMaxSize(), background(colors.background)];
const DIALOG_PROPERTIES = {
  usePlatformDefaultWidth: false,
  decorFitsSystemWindows: false,
  dismissOnBackPress: true,
  dismissOnClickOutside: false,
};

export function AppFullscreenModal(props: FullscreenModalProps) {
  if (!props.isOpen) return null;
  return <VisibleFullscreenModal {...props} />;
}

function VisibleFullscreenModal(props: FullscreenModalProps) {
  const { width } = useWindowDimensions();
  const portalHostName = `fullscreen-modal-${useId()}`;
  const [windowReady, setWindowReady] = useState(false);
  const readyRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const rootRef = useRef<ComponentRef<typeof SafeAreaView> | null>(null);
  const registerVoiceAuraTarget = useEvent(() => {
    const reactTag = findNodeHandle(rootRef.current);
    if (reactTag !== null) {
      configureNativeFullscreenWindow(reactTag);
      setNativeVoiceAuraTarget(reactTag);
    }
  });
  const onLayout = (event: LayoutChangeEvent): void => {
    if (event.nativeEvent.layout.width <= 0 || event.nativeEvent.layout.height <= 0) return;
    registerVoiceAuraTarget();
    if (readyRef.current) return;
    readyRef.current = true;
    frameRef.current = requestAnimationFrame(() => {
      setWindowReady(true);
      props.onShow?.();
    });
  };
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      setNativeVoiceAuraTarget(null);
    },
    [],
  );

  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <BasicAlertDialog
        onDismissRequest={props.onClose}
        properties={DIALOG_PROPERTIES}
        modifiers={FULLSCREEN_MODIFIERS}
      >
        <RNHostView matchContents={false}>
          <SafeAreaProvider style={styles.root}>
            <SafeAreaView
              ref={rootRef}
              collapsable={false}
              testID="fullscreen-modal-safe-area"
              edges={FULLSCREEN_SAFE_AREA_EDGES}
              style={styles.root}
              onLayout={onLayout}
            >
              <RecoverableRenderBoundary
                scope="dialog"
                label="Fullscreen modal"
                onDismiss={props.onClose}
              >
                <FullscreenWindowReadyProvider ready={windowReady}>
                  <OverlaySurfaceProvider
                    surface="fullscreen-modal"
                    portalHostName={portalHostName}
                  >
                    {props.children}
                    <PortalHost name={portalHostName} />
                  </OverlaySurfaceProvider>
                </FullscreenWindowReadyProvider>
              </RecoverableRenderBoundary>
            </SafeAreaView>
          </SafeAreaProvider>
        </RNHostView>
      </BasicAlertDialog>
    </Host>
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

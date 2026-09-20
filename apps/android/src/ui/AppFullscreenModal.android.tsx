import { BasicAlertDialog, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { background, fillMaxSize } from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  findNodeHandle,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, type Edge } from "react-native-safe-area-context";

import { configureNativeFullscreenWindow } from "../native/native-transport";
import { useEvent } from "../react/useEvent";
import { colors } from "../theme";
import { FullscreenWindowReadyProvider } from "./FullscreenWindowReady";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

interface FullscreenModalProps {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  onShow?: () => void;
}

const FULLSCREEN_SAFE_AREA_EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];
const FULLSCREEN_MODIFIERS = [fillMaxSize(), background(colors.background)];
const DIALOG_PROPERTIES = {
  decorFitsSystemWindows: false,
  dismissOnBackPress: true,
  dismissOnClickOutside: false,
  usePlatformDefaultWidth: false,
};

export function AppFullscreenModal(props: FullscreenModalProps) {
  if (!props.isOpen) {
    return null;
  }
  return <VisibleFullscreenModal {...props} />;
}

function VisibleFullscreenModal(props: FullscreenModalProps) {
  const { width } = useWindowDimensions();
  const [windowReady, setWindowReady] = useState(false);
  const readyRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const rootRef = useRef<ComponentRef<typeof SafeAreaView> | null>(null);
  const configureWindow = useEvent(() => {
    const reactTag = findNodeHandle(rootRef.current);
    if (reactTag !== null) {
      configureNativeFullscreenWindow(reactTag);
    }
  });
  const onLayout = (event: LayoutChangeEvent): void => {
    if (event.nativeEvent.layout.width <= 0 || event.nativeEvent.layout.height <= 0) {
      return;
    }
    configureWindow();
    if (readyRef.current) {
      return;
    }
    readyRef.current = true;
    frameRef.current = requestAnimationFrame(() => {
      setWindowReady(true);
      props.onShow?.();
    });
  };
  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <BasicAlertDialog
        modifiers={FULLSCREEN_MODIFIERS}
        onDismissRequest={props.onClose}
        properties={DIALOG_PROPERTIES}
      >
        <RNHostView matchContents={false}>
          <SafeAreaProvider style={styles.root}>
            <SafeAreaView
              collapsable={false}
              edges={FULLSCREEN_SAFE_AREA_EDGES}
              onLayout={onLayout}
              ref={rootRef}
              style={styles.root}
              testID="fullscreen-modal-safe-area"
            >
              <RecoverableRenderBoundary
                label="Fullscreen modal"
                onDismiss={props.onClose}
                scope="dialog"
              >
                <FullscreenWindowReadyProvider ready={windowReady}>
                  <OverlaySurfaceProvider surface="fullscreen-modal">
                    {props.children}
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
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
});

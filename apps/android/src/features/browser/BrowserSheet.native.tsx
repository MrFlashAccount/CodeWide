import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import { width as composeWidth } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactNode } from "react";
import {
  DeviceEventEmitter,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
} from "react-native";
import { BrowserSheetContent } from "../../native/BrowserSheetContent";
import { browserSheetContentAvailable } from "../../native/browserSheetCapabilities";
import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { OverlaySurfaceProvider } from "../../ui/OverlaySurfaceContext";
import { BrowserSheetFallback } from "./BrowserSheetFallback";
import { styles } from "./BrowserSheet.styles";

type BrowserSheetProps = {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly onCollapse: () => void;
  readonly presentationId: string;
};

/** A retained native sheet; the complete body blocks swipe handoff, leaving the grip draggable. */
export function BrowserSheet(props: BrowserSheetProps): React.JSX.Element {
  return browserSheetContentAvailable ? (
    <NativeBrowserSheet {...props} />
  ) : (
    <BrowserSheetFallback {...props} />
  );
}

function NativeBrowserSheet(props: BrowserSheetProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const dismiss = useEvent((event: { readonly nativeEvent: { readonly value: string } }): void => {
    if (props.active && event.nativeEvent.value === props.presentationId) {
      props.onCollapse();
    }
  });
  const back = useEvent((event: { readonly nativeEvent: { readonly value: string } }): void => {
    if (props.active && event.nativeEvent.value === props.presentationId) {
      // The native dialog intercepts Back; reuse the browser's history/DevTools/manager handlers.
      DeviceEventEmitter.emit("hardwareBackPress");
    }
  });
  return (
    <Host colorScheme="dark" pointerEvents="none" style={[styles.nativeHost, { width }]}>
      <ModalBottomSheet
        containerColor={colors.background}
        maxWidth={width}
        modifiers={[composeWidth(width)]}
        onBackPress={back}
        onDismissRequest={dismiss}
        presentationId={props.presentationId}
        properties={{ shouldDismissOnClickOutside: false }}
        sheetGesturesEnabled
        skipPartiallyExpanded
        visible={props.active}
      >
        <NativeSheetHandle active={props.active} onCollapse={props.onCollapse} />
        <NativeSheetBody>{props.children}</NativeSheetBody>
      </ModalBottomSheet>
    </Host>
  );
}

function NativeSheetBody(props: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <RNHostView>
      <BrowserSheetContent collapsable={false} style={styles.nativeSurface} testID="browser-sheet">
        <OverlaySurfaceProvider surface="native-sheet">{props.children}</OverlaySurfaceProvider>
      </BrowserSheetContent>
    </RNHostView>
  );
}

function NativeSheetHandle(props: {
  readonly active: boolean;
  readonly onCollapse: () => void;
}): React.JSX.Element {
  return (
    <ModalBottomSheet.DragHandle>
      <NativeSheetGrip {...props} />
    </ModalBottomSheet.DragHandle>
  );
}

function NativeSheetGrip(props: {
  readonly active: boolean;
  readonly onCollapse: () => void;
}): React.JSX.Element {
  const accessibleCollapse = useEvent((event: AccessibilityActionEvent): void => {
    if (props.active && event.nativeEvent.actionName === "collapse") {
      props.onCollapse();
    }
  });
  return (
    <RNHostView matchContents>
      <View
        accessibilityActions={[{ label: "Collapse browser", name: "collapse" }]}
        accessibilityHint="Drag down to return to the application without closing tabs"
        accessibilityLabel="Browser sheet handle"
        accessibilityRole="button"
        accessible
        onAccessibilityAction={accessibleCollapse}
        style={styles.grip}
        testID="browser-sheet-handle"
      >
        <View pointerEvents="none" style={styles.gripMark} />
      </View>
    </RNHostView>
  );
}

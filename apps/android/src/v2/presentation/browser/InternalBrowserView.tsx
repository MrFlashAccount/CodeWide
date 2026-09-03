import { useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
  type PanResponderInstance,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

import { useEvent } from "../../../react/useEvent";
import type { PreviewStreamSource } from "../../application/preview/previewTransport";
import type { DevToolsDockSide } from "../../application/ports/browserDevTools";
import { colors } from "../../theme";
import { BrowserDevToolsPane } from "./BrowserDevToolsPane";
import { BrowserToolbar } from "./BrowserToolbar";
import { ShimmerText } from "../text/ShimmerText";

interface InternalBrowserControllerProps {
  closeDevTools(): void;
  devToolsBootstrap: string;
  devToolsDockSide: DevToolsDockSide;
  devToolsError: string | null;
  devToolsLoading: boolean;
  devToolsDocumentLoading: boolean;
  devToolsUrl: string | null;
  goBack(): void;
  goForward(): void;
  healthProbe: string;
  navigation: Pick<WebViewNavigation, "canGoBack" | "canGoForward" | "url">;
  onDevToolsError(message: string): void;
  onDevToolsLoadStart(): void;
  onDevToolsMessage(event: WebViewMessageEvent): void;
  onNavigation(value: WebViewNavigation): void;
  onRendererGone(didCrash: boolean): void;
  openDevTools(): Promise<void>;
  reload(): void;
  retryDevTools(): void;
  setBrowserRef(value: WebView | null): void;
  setDevToolsRef(value: WebView | null): void;
  toggleTrace(): Promise<void>;
  traceRunning: boolean;
  traceSupported: boolean;
  traceStatus: string | null;
}

export interface InternalBrowserContentProps {
  onClose(): void | Promise<void>;
  onError(message: string): void;
  onHttpError(statusCode: number): void;
  source: PreviewStreamSource;
  status: string;
  title: string;
}

export interface InternalBrowserViewProps
  extends InternalBrowserContentProps, InternalBrowserControllerProps {}

export function InternalBrowserView(props: InternalBrowserViewProps): React.JSX.Element {
  const {
    closeDevTools,
    devToolsBootstrap,
    devToolsDockSide,
    devToolsDocumentLoading,
    devToolsError,
    devToolsLoading,
    devToolsUrl,
    goBack,
    goForward,
    healthProbe,
    navigation,
    onClose,
    onDevToolsError,
    onDevToolsLoadStart,
    onDevToolsMessage,
    onError,
    onHttpError,
    onNavigation,
    onRendererGone,
    openDevTools,
    reload,
    retryDevTools,
    setBrowserRef,
    setDevToolsRef,
    source,
    status,
    title,
    toggleTrace,
    traceRunning,
    traceStatus,
    traceSupported,
  } = props;
  const [targetFraction, setTargetFraction] = useState(0.5);
  const contentSize = useRef({ height: 0, width: 0 });
  const dragStartFraction = useRef(targetFraction);
  const vertical = devToolsDockSide === "left" || devToolsDockSide === "right";
  const shouldResize = useEvent(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) =>
      shouldStartResize(vertical, gesture),
  );
  const resize = useEvent((_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
    const axisSize = vertical ? contentSize.current.width : contentSize.current.height;
    if (axisSize <= 0) return;
    const delta = vertical ? gesture.dx : gesture.dy;
    const direction = devToolsDockSide === "left" ? -1 : 1;
    setTargetFraction(clamp(dragStartFraction.current + (direction * delta) / axisSize, 0.2, 0.8));
  });
  const beginResize = useEvent(() => {
    dragStartFraction.current = targetFraction;
  });
  const [divider] = useState(() =>
    createDividerPanResponder({ beginResize, resize, shouldResize }),
  );
  const layout = useEvent((event: LayoutChangeEvent) => {
    contentSize.current = event.nativeEvent.layout;
  });
  const webViewError = useEvent((event: BrowserErrorEvent) => {
    onError(event.nativeEvent.description);
  });
  const webViewHttpError = useEvent((event: BrowserHttpErrorEvent) => {
    onHttpError(event.nativeEvent.statusCode);
  });
  const rendererGone = useEvent((event: BrowserRendererGoneEvent) => {
    onError(
      event.nativeEvent.didCrash ? "Android WebView renderer crashed" : "Android stopped WebView",
    );
  });
  const targetStyle = targetPaneStyle(
    devToolsUrl !== null,
    devToolsDockSide,
    vertical,
    targetFraction,
  );
  return (
    <View style={styles.root}>
      <BrowserToolbar
        canGoBack={navigation.canGoBack}
        canGoForward={navigation.canGoForward}
        closeDevTools={closeDevTools}
        devToolsLoading={devToolsLoading}
        devToolsOpen={devToolsUrl !== null}
        goBack={goBack}
        goForward={goForward}
        location={navigation.url}
        onClose={onClose}
        openDevTools={openDevTools}
        reload={reload}
        status={status}
        title={title}
        toggleTrace={toggleTrace}
        traceRunning={traceRunning}
        traceStatus={traceStatus}
        traceSupported={traceSupported}
      />
      <View
        onLayout={layout}
        testID="browser-split-content"
        style={[
          styles.content,
          vertical && (devToolsDockSide === "left" ? styles.rowReverse : styles.row),
        ]}
      >
        <View style={targetStyle} testID="browser-target-pane">
          <WebView
            ref={setBrowserRef}
            domStorageEnabled
            javaScriptEnabled
            onError={webViewError}
            onHttpError={webViewHttpError}
            onNavigationStateChange={onNavigation}
            onRenderProcessGone={rendererGone}
            originWhitelist={[originPattern(source.uri)]}
            renderLoading={BrowserLoading}
            sharedCookiesEnabled
            source={{
              uri: source.uri,
              ...(source.headers === null ? {} : { headers: source.headers }),
            }}
            startInLoadingState
            style={styles.webView}
            thirdPartyCookiesEnabled={false}
          />
        </View>
        {devToolsUrl === null ? null : (
          <BrowserDevToolsPane
            closeDevTools={closeDevTools}
            devToolsBootstrap={devToolsBootstrap}
            devToolsDocumentLoading={devToolsDocumentLoading}
            devToolsError={devToolsError}
            devToolsUrl={devToolsUrl}
            dividerHandlers={divider.panHandlers}
            healthProbe={healthProbe}
            onDevToolsError={onDevToolsError}
            onDevToolsLoadStart={onDevToolsLoadStart}
            onDevToolsMessage={onDevToolsMessage}
            onRendererGone={onRendererGone}
            retryDevTools={retryDevTools}
            setDevToolsRef={setDevToolsRef}
            vertical={vertical}
          />
        )}
      </View>
    </View>
  );
}

interface BrowserErrorEvent {
  nativeEvent: { description: string };
}

interface BrowserHttpErrorEvent {
  nativeEvent: { statusCode: number };
}

interface BrowserRendererGoneEvent {
  nativeEvent: { didCrash: boolean };
}

interface DividerGestureHandlers {
  beginResize(): void;
  resize(event: GestureResponderEvent, gesture: PanResponderGestureState): void;
  shouldResize(event: GestureResponderEvent, gesture: PanResponderGestureState): boolean;
}

function createDividerPanResponder(handlers: DividerGestureHandlers): PanResponderInstance {
  return PanResponder.create({
    onMoveShouldSetPanResponder: handlers.shouldResize,
    onPanResponderGrant: handlers.beginResize,
    onPanResponderMove: handlers.resize,
    onStartShouldSetPanResponder: acceptDividerGesture,
  });
}

function acceptDividerGesture(): boolean {
  return true;
}

function shouldStartResize(vertical: boolean, gesture: PanResponderGestureState): boolean {
  return Math.abs(vertical ? gesture.dx : gesture.dy) > 2;
}

function targetPaneStyle(
  open: boolean,
  side: DevToolsDockSide,
  vertical: boolean,
  fraction: number,
): StyleProp<ViewStyle> {
  if (!open) return styles.targetClosed;
  if (side === "undocked") return [styles.target, styles.targetUndocked];
  return [
    styles.target,
    vertical ? { width: `${fraction * 100}%` } : { height: `${fraction * 100}%` },
  ];
}

function originPattern(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "about:blank";
  }
}

function BrowserLoading(): React.JSX.Element {
  return <ShimmerText containerStyle={styles.loading} text="Loading browser…" />;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0 },
  loading: { alignSelf: "center", position: "absolute", top: "48%" },
  root: { backgroundColor: colors.background, flex: 1, minHeight: 0, minWidth: 0 },
  row: { flexDirection: "row" },
  rowReverse: { flexDirection: "row-reverse" },
  target: { flexShrink: 0, minHeight: 0, minWidth: 0 },
  targetClosed: { flex: 1, minHeight: 0, minWidth: 0 },
  targetUndocked: { height: 1, opacity: 0, position: "absolute", width: 1 },
  webView: { backgroundColor: colors.background, flex: 1 },
});

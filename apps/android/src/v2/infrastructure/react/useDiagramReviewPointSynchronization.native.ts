import { useEffect, type RefObject } from "react";
import type { WebView } from "react-native-webview";

/** Synchronizes declarative review markers into the imperative diagram WebView. */
export function useDiagramReviewPointSynchronization(
  webViewRef: RefObject<WebView | null>,
  enabled: boolean,
  reviewPointsKey: string,
): void {
  useEffect(() => {
    if (!enabled) return;
    webViewRef.current?.injectJavaScript(`window.diagramSetReviewPoints(${reviewPointsKey});true;`);
  }, [enabled, reviewPointsKey, webViewRef]);
}

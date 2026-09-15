import type { RefObject } from "react";
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";
import { WebView } from "react-native-webview";
import type { InternalBrowserHeader } from "./browserContract";

export function useBrowserBack(
  header: InternalBrowserHeader | undefined,
  devToolsUrl: string | null,
  closeDevTools: () => void,
  canGoBack: boolean,
  webView: RefObject<WebView | null>,
) {
  useEffect(() => {
    if (Platform.OS !== "android" || header === undefined) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (devToolsUrl !== null) closeDevTools();
      else if (canGoBack) webView.current?.goBack();
      else header.onClose();
      return true;
    });
    return () => subscription.remove();
  }, [closeDevTools, devToolsUrl, header, canGoBack, webView]);
}

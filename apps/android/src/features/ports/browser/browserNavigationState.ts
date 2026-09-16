import { useRef, useState } from "react";
import type { WebView, WebViewNavigation } from "react-native-webview";
import { useEvent } from "../../../react/useEvent";

export function useBrowserNavigationState(url: string) {
  const webView = useRef<WebView>(null);
  const [addressSource, setAddressSource] = useState({ initialUrl: url, uri: url });
  const [navigation, setNavigation] = useState<
    Pick<WebViewNavigation, "url" | "title" | "canGoBack" | "canGoForward" | "loading">
  >({
    canGoBack: false,
    canGoForward: false,
    loading: false,
    title: "",
    url,
  });
  if (addressSource.initialUrl !== url) {
    setAddressSource({ initialUrl: url, uri: url });
    setNavigation({ canGoBack: false, canGoForward: false, loading: false, title: "", url });
  }
  const navigateAddress = useEvent((target: string) => {
    if (target === navigation.url) {
      webView.current?.reload();
      return;
    }
    setAddressSource({ initialUrl: url, uri: target });
    setNavigation({ ...navigation, loading: true, url: target });
  });
  const updateNavigation = useEvent((event: WebViewNavigation) => {
    setNavigation({
      canGoBack: event.canGoBack,
      canGoForward: event.canGoForward,
      loading: event.loading,
      title: event.title,
      url: event.url,
    });
    // On Android setSource is a no-op for the WebView's current URL. Synchronize
    // only settled pages so re-entering a URL after Back is a new load, without
    // restarting in-flight redirects or recreating the WebView/history.
    if (!event.loading && /^https?:\/\//iu.test(event.url)) {
      setAddressSource({ initialUrl: url, uri: event.url });
    }
  });
  const [addressEditing, setAddressEditing] = useState(false);
  return {
    addressEditing,
    addressSource,
    navigateAddress,
    navigation,
    setAddressEditing,
    updateNavigation,
    webView,
  };
}

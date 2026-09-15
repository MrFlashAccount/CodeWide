import { useRef, useState } from "react";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useEvent } from "../../../react/useEvent";
export function useBrowserNavigationState(url: string) {
  const webView = useRef<WebView>(null);
  const [addressSource, setAddressSource] = useState({ initialUrl: url, uri: url });
  const [navigation, setNavigation] = useState<
    Pick<WebViewNavigation, "url" | "title" | "canGoBack" | "canGoForward" | "loading">
  >({
    url,
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  });
  if (addressSource.initialUrl !== url) {
    setAddressSource({ initialUrl: url, uri: url });
    setNavigation({ url, title: "", canGoBack: false, canGoForward: false, loading: false });
  }
  const navigateAddress = useEvent((target: string) => {
    if (target === navigation.url) {
      webView.current?.reload();
      return;
    }
    setAddressSource({ initialUrl: url, uri: target });
    setNavigation({ ...navigation, url: target, loading: true });
  });
  const updateNavigation = useEvent((event: WebViewNavigation) => {
    setNavigation({
      url: event.url,
      title: event.title,
      canGoBack: event.canGoBack,
      canGoForward: event.canGoForward,
      loading: event.loading,
    });
    // On Android setSource is a no-op for the WebView's current URL. Synchronize
    // only settled pages so re-entering a URL after Back is a new load, without
    // restarting in-flight redirects or recreating the WebView/history.
    if (!event.loading && /^https?:\/\//iu.test(event.url))
      setAddressSource({ initialUrl: url, uri: event.url });
  });
  const [addressEditing, setAddressEditing] = useState(false);
  return {
    webView,
    addressSource,
    navigation,
    navigateAddress,
    updateNavigation,
    addressEditing,
    setAddressEditing,
  };
}

import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useRef, useState } from "react";
import type { WebView, WebViewNavigation } from "react-native-webview";
import { useEvent } from "../../react/useEvent";

/** Browser-owned projection of native navigation, independent of the external event DTO. */
export type BrowserNavigation = {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly loading: boolean;
  readonly title: string;
  readonly url: string;
};

type NavigationState = {
  readonly addressEditing: boolean;
  readonly addressSource: { readonly initialUrl: string; readonly uri: string };
  readonly navigation: BrowserNavigation;
};

function initialNavigation(url: string): BrowserNavigation {
  return { canGoBack: false, canGoForward: false, loading: false, title: "", url };
}

function navigationOwner(url: string) {
  return {
    initialUrl: url,
    state$: observable<NavigationState>({
      addressEditing: false,
      addressSource: { initialUrl: url, uri: url },
      navigation: initialNavigation(url),
    }),
  };
}

/** Retains one page's native handle and observable interaction state across browser renders. */
export function useBrowserNavigationState(url: string) {
  const webView = useRef<WebView>(null);
  const [owner, setOwner] = useState(() => navigationOwner(url));
  if (owner.initialUrl !== url) {
    // Replace the owner for an explicit caller destination without notifying the previous
    // observable's subscribers during render. React restarts this render with the new owner.
    setOwner(navigationOwner(url));
  }
  const state$ = owner.state$;
  const state = useSelector(state$);
  const navigateAddress = useEvent((target: string) => {
    const current = state$.peek();
    if (target === current.navigation.url) {
      webView.current?.reload();
      return;
    }
    state$.set({
      addressEditing: current.addressEditing,
      addressSource: { initialUrl: url, uri: target },
      navigation: { ...current.navigation, loading: true, url: target },
    });
  });
  const updateNavigation = useEvent((event: WebViewNavigation) => {
    const current = state$.peek();
    state$.set({
      addressEditing: current.addressEditing,
      // Android's setSource skips its current URL. Only settled pages may update the seed,
      // so redirects retain their native history and re-entering a URL after Back loads again.
      addressSource:
        !event.loading && /^https?:\/\//iu.test(event.url)
          ? { initialUrl: url, uri: event.url }
          : current.addressSource,
      navigation: {
        canGoBack: event.canGoBack,
        canGoForward: event.canGoForward,
        loading: event.loading,
        title: event.title,
        url: event.url,
      },
    });
  });
  const setAddressEditing = useEvent((editing: boolean): void => {
    state$.addressEditing.set(editing);
  });
  return {
    addressEditing: state.addressEditing,
    addressSource: state.addressSource,
    navigateAddress,
    navigation: state.navigation,
    setAddressEditing,
    updateNavigation,
    webView,
  };
}

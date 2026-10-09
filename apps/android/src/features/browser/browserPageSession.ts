import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import type { RefObject } from "react";
import type { WebView } from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigation,
  WebViewNavigationEvent,
  WebViewOpenWindowEvent,
  WebViewProgressEvent,
  WebViewRenderProcessGoneEvent,
} from "react-native-webview/lib/WebViewTypes";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import type { BrowserNavigation } from "./browserNavigationState";
import type { BrowserPageStatus } from "./BrowserPageFeedback";
import type { BrowserFaviconSession } from "./browserFaviconSession";
import {
  browserAllowedPageUrl,
  browserPageUrl,
  browserNativeTarget,
} from "./browserNavigationPolicy";

const MIN_HTTP_ERROR_STATUS = 400;
const MAX_HTTP_ERROR_STATUS = 599;

type BrowserPageSession = {
  readonly back: () => void;
  readonly goForward: () => void;
  readonly httpFailed: (event: WebViewHttpErrorEvent) => void;
  readonly loadingStarted: (event: WebViewNavigationEvent) => void;
  readonly navigate: (url: string) => void;
  readonly navigationChanged: (event: WebViewNavigation) => void;
  readonly newWindow: (event: WebViewOpenWindowEvent) => void;
  readonly pageFailed: (event: WebViewErrorEvent) => void;
  readonly progress: number;
  readonly progressChanged: (event: WebViewProgressEvent) => void;
  readonly rendererGone: (event: WebViewRenderProcessGoneEvent) => void;
  readonly retry: () => void;
  readonly revision: number;
  readonly shouldNavigate: (request: ShouldStartLoadRequest) => boolean;
  readonly showNotice: (message: string) => void;
  readonly status: BrowserPageStatus;
  readonly stopLoading: () => void;
};

/** Adapts native page events and recovery without granting page content application authority. */
export function useBrowserPageSession(props: {
  readonly active: boolean;
  readonly favicon: BrowserFaviconSession;
  readonly navigateAddress: (url: string) => void;
  readonly navigation: BrowserNavigation;
  readonly onClose: (() => void) | undefined;
  readonly onError: ((message: string) => void) | undefined;
  readonly onHttpError: ((statusCode: number) => void) | undefined;
  readonly onNavigation:
    | ((metadata: {
        readonly loading: boolean;
        readonly title: string;
        readonly url: string;
      }) => void)
    | undefined;
  readonly onOpenWindow: ((url: string) => boolean) | undefined;
  readonly originWhitelist: readonly string[];
  readonly updateNavigation: (event: WebViewNavigation) => void;
  readonly webView: RefObject<WebView | null>;
}): BrowserPageSession {
  const {
    active,
    navigateAddress,
    navigation,
    onClose,
    onError,
    onHttpError,
    onNavigation,
    onOpenWindow,
    originWhitelist,
    updateNavigation,
    webView,
  } = props;
  const page$ = useConstant(() =>
    observable<{ discardedTarget: number | null; revision: number; status: BrowserPageStatus }>({
      discardedTarget: null,
      revision: 0,
      status: { kind: "ready" },
    }),
  );
  const page = useSelector(page$);
  const progress$ = useConstant(() => observable(0));
  const progress = useSelector(progress$);
  const progressChanged = useEvent((event: WebViewProgressEvent): void => {
    const native = event.nativeEvent;
    if (
      (page$.peek().discardedTarget === null ||
        browserNativeTarget(native) !== page$.peek().discardedTarget) &&
      Number.isFinite(native.progress)
    ) {
      progress$.set(Math.max(0, Math.min(1, native.progress)));
    }
  });
  const retry = useEvent(() => {
    props.favicon.reset();
    const current = page$.peek();
    if (current.status.kind === "failed" && current.status.recovery === "recreate") {
      page$.set({
        discardedTarget: current.discardedTarget,
        revision: current.revision + 1,
        status: { kind: "ready" },
      });
    } else {
      page$.status.set({ kind: "ready" });
      webView.current?.reload();
    }
  });
  const back = useEvent(() => {
    if (navigation.canGoBack) {
      webView.current?.goBack();
    } else {
      onClose?.();
    }
  });
  const goForward = useEvent(() => webView.current?.goForward());
  const stopLoading = useEvent(() => webView.current?.stopLoading());
  const navigate = useEvent((target: string) => {
    if (browserAllowedPageUrl(target, originWhitelist) === null) {
      page$.status.set({ kind: "notice", message: "This address is not supported in the browser" });
      return;
    }
    page$.status.set({ kind: "ready" });
    props.favicon.reset();
    navigateAddress(target);
  });
  const loadingStarted = useEvent((event: WebViewNavigationEvent) => {
    if (
      page$.peek().discardedTarget === null ||
      browserNativeTarget(event.nativeEvent) !== page$.peek().discardedTarget
    ) {
      progress$.set(0);
      page$.status.set({ kind: "ready" });
      const target = browserNativeTarget(event.nativeEvent);
      if (target !== null) {
        props.favicon.started(target, event.nativeEvent.url);
      }
    }
  });
  const navigationChanged = useEvent((event: WebViewNavigation) => {
    if (
      page$.peek().discardedTarget !== null &&
      browserNativeTarget(event) === page$.peek().discardedTarget
    ) {
      return;
    }
    if (event.url === "about:blank" || browserPageUrl(event.url) !== null) {
      updateNavigation(event);
      onNavigation?.({ loading: event.loading, title: event.title, url: event.url });
      const target = browserNativeTarget(event);
      if (!event.loading && target !== null) {
        props.favicon.committed(target, event.url);
      }
    }
  });
  const pageFailed = useEvent((event: WebViewErrorEvent) => {
    event.preventDefault();
    if (
      page$.peek().discardedTarget !== null &&
      browserNativeTarget(event.nativeEvent) === page$.peek().discardedTarget
    ) {
      return;
    }
    const message = event.nativeEvent.description.startsWith("SSL error:")
      ? "This page's certificate could not be verified"
      : "This page could not be loaded";
    page$.status.set({ kind: "failed", message, recovery: "reload" });
    onError?.(message);
  });
  const httpFailed = useEvent((event: WebViewHttpErrorEvent) => {
    const statusCode = event.nativeEvent.statusCode;
    if (
      (page$.peek().discardedTarget === null ||
        browserNativeTarget(event.nativeEvent) !== page$.peek().discardedTarget) &&
      Number.isInteger(statusCode) &&
      statusCode >= MIN_HTTP_ERROR_STATUS &&
      statusCode <= MAX_HTTP_ERROR_STATUS
    ) {
      page$.status.set({ kind: "http", statusCode });
      onHttpError?.(statusCode);
    }
  });
  const rendererGone = useEvent((event: WebViewRenderProcessGoneEvent) => {
    const current = page$.peek();
    if (
      current.discardedTarget !== null &&
      browserNativeTarget(event.nativeEvent) === current.discardedTarget
    ) {
      return;
    }
    page$.set({
      discardedTarget: browserNativeTarget(event.nativeEvent),
      revision: current.revision,
      status: {
        kind: "failed",
        message: "This page was closed by Android. Retry to reopen it.",
        recovery: "recreate",
      },
    });
    props.favicon.reset();
  });
  const newWindow = useEvent((event: WebViewOpenWindowEvent) => {
    if (!active) {
      return;
    }
    const target = browserAllowedPageUrl(event.nativeEvent.targetUrl, originWhitelist);
    if (target === null) {
      page$.status.set({ kind: "notice", message: "This link is not supported in the browser" });
    } else if (onOpenWindow?.(target) !== true) {
      page$.status.set({ kind: "notice", message: "This window could not be opened" });
    }
  });
  const shouldNavigate = useEvent((request: ShouldStartLoadRequest) => {
    if (
      request.url === "about:blank" ||
      browserAllowedPageUrl(request.url, originWhitelist) !== null
    ) {
      return true;
    }
    page$.status.set({ kind: "notice", message: "This link is not supported in the browser" });
    return false;
  });

  const showNotice = useEvent((message: string): void => {
    page$.status.set({ kind: "notice", message });
  });
  return {
    back,
    goForward,
    httpFailed,
    loadingStarted,
    navigate,
    navigationChanged,
    newWindow,
    pageFailed,
    progress,
    progressChanged,
    rendererGone,
    retry,
    revision: page.revision,
    shouldNavigate,
    showNotice,
    status: page.status,
    stopLoading,
  };
}

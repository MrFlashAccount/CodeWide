import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { WebView, WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import { appLogger } from "../../observability/logger";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import {
  createDevToolsFailure,
  type DevToolsFailure,
  type DevToolsFailureKind,
} from "../../ui/DevToolsErrorBoundary";
import { parseDevToolsMessage, redactDevToolsUrl, type DevToolsDockSide } from "./devToolsMessage";
import { browserLocation, chromiumDevToolsUrl } from "./devToolsTarget";
import { BrowserInspectionSession } from "./browserInspectionSession";

export function useBrowserDevTools(
  webView: RefObject<WebView | null>,
  navigation: Pick<WebViewNavigation, "url">,
  options: {
    readonly active: boolean;
    readonly onError: ((description: string) => void) | undefined;
  },
) {
  const { active, onError } = options;
  const inspection = useConstant(() => new BrowserInspectionSession());
  const devToolsWebView = useRef<WebView>(null);
  const [devToolsUrl, setDevToolsUrl] = useState<string | null>(null);
  const [devToolsLoading, setDevToolsLoading] = useState(false);
  const [devToolsDocumentLoading, setDevToolsDocumentLoading] = useState(false);
  const [devToolsFailure, setDevToolsFailure] = useState<DevToolsFailure | null>(null);
  const [devToolsRevision, setDevToolsRevision] = useState(0);
  const [devToolsDockSide, setDevToolsDockSide] = useState<DevToolsDockSide>("bottom");
  const reportError = useEvent((cause: unknown, fallback: string) => {
    onError?.(cause instanceof Error ? cause.message : fallback);
  });
  const captureDevToolsFailure = useEvent(
    (kind: DevToolsFailureKind, message: string, detail?: string) => {
      const failure = createDevToolsFailure(kind, message, {
        context: [
          `Target: ${browserLocation(navigation.url)}`,
          devToolsUrl === null ? null : `Frontend: ${redactDevToolsUrl(devToolsUrl)}`,
          detail ?? null,
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
      });
      appLogger.warn({ event: "browser_devtools.failure" });
      setDevToolsFailure(failure);
      return failure;
    },
  );
  const openDevTools = useEvent(async () => {
    if (!inspection.isActive()) {
      return;
    }
    setDevToolsLoading(true);
    setDevToolsDocumentLoading(true);
    setDevToolsFailure(null);
    const result = await inspection.open(webView.current, navigation.url);
    if (result.status === "cancelled") {
      return;
    }
    if (result.status === "ready") {
      setDevToolsUrl(chromiumDevToolsUrl(result.endpoint, result.target));
    } else {
      setDevToolsUrl(null);
      setDevToolsDocumentLoading(false);
      const message =
        result.cause instanceof Error
          ? result.cause.message
          : "Could not connect Chromium DevTools to this page";
      captureDevToolsFailure("bridge", message);
      reportError(result.cause, message);
    }
    // WHY: The inspection owner returns only current results; cancelled work is
    // settled by close. React Compiler cannot lower finally inside this UI hook.
    // oxlint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
    setDevToolsLoading(false);
  });
  const closeDevTools = useEvent(() => {
    inspection.close();
    setDevToolsLoading(false);
    setDevToolsUrl(null);
    setDevToolsDocumentLoading(false);
    setDevToolsFailure(null);
    setDevToolsDockSide("bottom");
  });
  const handleDevToolsMessage = useEvent((event: WebViewMessageEvent) => {
    const message = parseDevToolsMessage(event.nativeEvent.data);
    if (message === null) {
      return;
    }
    if (message.source === "codewide-devtools-ui") {
      closeDevTools();
      return;
    }
    if (message.source === "codewide-devtools-dock") {
      setDevToolsDockSide(message.side);
      return;
    }
    if (message.source === "codewide-devtools-transport") {
      if (message.event === "close") {
        const detail = [
          `Close code: ${String(message.code)}`,
          message.reason.length > 0 ? `Reason: ${message.reason}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join("\n");
        captureDevToolsFailure("bridge", "Chrome DevTools Protocol connection closed", detail);
        onError?.(`Chromium DevTools: CDP connection closed (${String(message.code)})`);
      }
      return;
    }
    setDevToolsDocumentLoading(false);
    if (message.state === "ready") {
      setDevToolsFailure(null);
      return;
    }
    const description = message.message ?? "Chromium DevTools did not render";
    captureDevToolsFailure("health", description);
    onError?.(`Chromium DevTools: ${description}`);
  });
  const retryDevTools = useEvent(() => {
    setDevToolsFailure(null);
    setDevToolsDocumentLoading(true);
    setDevToolsRevision((revision) => revision + 1);
  });
  useEffect(() => {
    inspection.setActive(active);
    if (!active) {
      closeDevTools();
    }
    return () => {
      inspection.setActive(false);
    };
  }, [active, closeDevTools, inspection]);
  const captureScreenshot = useEvent(async () =>
    inspection.capture(webView.current, navigation.url),
  );
  const isMounted = useEvent(() => inspection.isActive());
  return {
    captureDevToolsFailure,
    captureScreenshot,
    closeDevTools,
    devToolsDockSide,
    devToolsDocumentLoading,
    devToolsFailure,
    devToolsLoading,
    devToolsRevision,
    devToolsUrl,
    devToolsWebView,
    handleDevToolsMessage,
    isMounted,
    openDevTools,
    retryDevTools,
    setDevToolsDocumentLoading,
    setDevToolsFailure,
  };
}

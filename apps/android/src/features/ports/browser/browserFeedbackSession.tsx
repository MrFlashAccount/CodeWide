import type { RefObject } from "react";
import { useRef, useState } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useEvent } from "../../../react/useEvent";
import { useAppFullscreenOverlay } from "../../../ui/AppFullscreenOverlay";
import { AppVoiceInputProvider, useAppVoiceInputRuntime } from "../../../ui/VoiceInputRuntime";
import { useBrowserFeedback } from "./BrowserFeedbackContext";
import { BrowserFeedbackDialog } from "./BrowserFeedbackDialog";
import {
  BROWSER_FEEDBACK_BOOTSTRAP,
  parseBrowserElementReport,
  type BrowserFeedbackCapability,
  type BrowserFeedbackDraft,
} from "./feedback";
export function useBrowserFeedbackSession(
  suppliedFeedback: BrowserFeedbackCapability | undefined,
  webView: RefObject<WebView | null>,
  captureScreenshot: () => Promise<string | null>,
  isMounted: () => boolean,
) {
  const inheritedFeedback = useBrowserFeedback();
  const feedback = suppliedFeedback ?? inheritedFeedback ?? undefined;
  const feedbackOverlay = useAppFullscreenOverlay();
  const feedbackVoiceRuntime = useAppVoiceInputRuntime();
  const feedbackArmed = useRef(false);
  const [feedbackSelecting, setFeedbackSelecting] = useState(false);
  const [feedbackCapturing, setFeedbackCapturing] = useState(false);
  const selectFeedbackElement = useEvent(() => {
    feedbackArmed.current = !feedbackArmed.current;
    setFeedbackSelecting(feedbackArmed.current);
    webView.current?.injectJavaScript(
      `${BROWSER_FEEDBACK_BOOTSTRAP}\nwindow.__codewideFeedback?.${feedbackArmed.current ? "start" : "clear"}(); true;`,
    );
  });
  const closeFeedback = useEvent(() => {
    webView.current?.injectJavaScript("window.__codewideFeedback?.clear(); true;");
  });
  const captureFeedback = useEvent(async (event: WebViewMessageEvent) => {
    if (!feedbackArmed.current || feedback === undefined) return;
    let report;
    try {
      report = parseBrowserElementReport(JSON.parse(event.nativeEvent.data));
    } catch {
      return;
    }
    if (report === null) return;
    feedbackArmed.current = false;
    setFeedbackSelecting(false);
    setFeedbackCapturing(true);
    let screenshot: string | null = null;
    let screenshotError: string | null = null;
    try {
      screenshot = await captureScreenshot();
    } catch (cause) {
      screenshotError = cause instanceof Error ? cause.message : "Capture failed";
    }
    if (isMounted()) {
      const draft: BrowserFeedbackDraft = { report, screenshot, screenshotError };
      feedbackOverlay.present((controls) => {
        const content = (
          <BrowserFeedbackDialog
            draft={draft}
            capability={feedback}
            onClose={() => {
              closeFeedback();
              controls.close();
            }}
          />
        );
        return feedbackVoiceRuntime === null ? (
          content
        ) : (
          <AppVoiceInputProvider runtime={feedbackVoiceRuntime}>{content}</AppVoiceInputProvider>
        );
      });
      setFeedbackCapturing(false);
    }
  });
  return { feedback, feedbackSelecting, feedbackCapturing, selectFeedbackElement, captureFeedback };
}

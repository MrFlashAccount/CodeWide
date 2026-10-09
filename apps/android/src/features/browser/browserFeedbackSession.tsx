import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { WebView, WebViewMessageEvent } from "react-native-webview";
import { useEvent } from "../../react/useEvent";
import { useAppFullscreenOverlay } from "../../ui/AppFullscreenOverlay";
import { AppVoiceInputProvider, useAppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { useBrowserFeedback } from "./BrowserFeedbackContext";
import { BrowserFeedbackDialog } from "./BrowserFeedbackDialog";
import {
  BROWSER_FEEDBACK_BOOTSTRAP,
  parseBrowserElementReport,
  type BrowserFeedbackCapability,
  type BrowserFeedbackDraft,
} from "./feedback";

function browserFeedbackReport(message: string) {
  try {
    return parseBrowserElementReport(JSON.parse(message));
  } catch {
    return null;
  }
}

function browserFeedbackAdmission(input: {
  readonly active: boolean;
  readonly armed: boolean;
  readonly feedback: BrowserFeedbackCapability | undefined;
  readonly message: string;
}) {
  if (!input.active || !input.armed || input.feedback === undefined) {
    return null;
  }
  const report = browserFeedbackReport(input.message);
  return report === null ? null : { capability: input.feedback, report };
}

export function useBrowserFeedbackSession(
  suppliedFeedback: BrowserFeedbackCapability | undefined,
  webView: RefObject<WebView | null>,
  captureScreenshot: () => Promise<string | null>,
  isMounted: () => boolean,
  active = true,
) {
  const inheritedFeedback = useBrowserFeedback();
  const feedback = suppliedFeedback ?? inheritedFeedback ?? undefined;
  const feedbackOverlay = useAppFullscreenOverlay();
  const feedbackVoiceRuntime = useAppVoiceInputRuntime();
  const feedbackArmed = useRef(false);
  const generation = useRef(0);
  const feedbackCaptureTask = useRef<Promise<void> | null>(null);
  const [feedbackSelecting, setFeedbackSelecting] = useState(false);
  const [feedbackCapturing, setFeedbackCapturing] = useState(false);
  const selectFeedbackElement = useEvent(() => {
    if (!active) {
      return;
    }
    feedbackArmed.current = !feedbackArmed.current;
    setFeedbackSelecting(feedbackArmed.current);
    webView.current?.injectJavaScript(
      `${BROWSER_FEEDBACK_BOOTSTRAP}\nwindow.__codewideFeedback?.${feedbackArmed.current ? "start" : "clear"}(); true;`,
    );
  });
  const closeFeedback = useEvent(() => {
    generation.current += 1;
    feedbackArmed.current = false;
    setFeedbackSelecting(false);
    setFeedbackCapturing(false);
    webView.current?.injectJavaScript("window.__codewideFeedback?.clear(); true;");
  });
  useEffect(() => {
    if (!active) {
      closeFeedback();
    }
  }, [active, closeFeedback]);
  const captureFeedbackAsync = useEvent(async (event: WebViewMessageEvent) => {
    const admission = browserFeedbackAdmission({
      active,
      armed: feedbackArmed.current,
      feedback,
      message: event.nativeEvent.data,
    });
    if (admission === null) {
      return;
    }
    const { capability, report } = admission;
    feedbackArmed.current = false;
    setFeedbackSelecting(false);
    setFeedbackCapturing(true);
    let screenshot: string | null = null;
    const revision = generation.current;
    let screenshotError: string | null = null;
    try {
      screenshot = await captureScreenshot();
    } catch (error) {
      screenshotError = error instanceof Error ? error.message : "Capture failed";
    }
    if (isMounted() && revision === generation.current) {
      const draft: BrowserFeedbackDraft = { report, screenshot, screenshotError };
      feedbackOverlay.present((controls) => {
        const content = (
          <BrowserFeedbackDialog
            capability={capability}
            draft={draft}
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
  const captureFeedback = useEvent((event: WebViewMessageEvent) => {
    feedbackCaptureTask.current = captureFeedbackAsync(event).then(
      () => {
        feedbackCaptureTask.current = null;
      },
      () => {
        feedbackCaptureTask.current = null;
        if (isMounted()) {
          setFeedbackCapturing(false);
        }
      },
    );
  });
  return { captureFeedback, feedback, feedbackCapturing, feedbackSelecting, selectFeedbackElement };
}

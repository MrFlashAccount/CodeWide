import { useId, useLayoutEffect, useRef, type ComponentProps, type ComponentRef } from "react";
import {
  DeviceEventEmitter,
  findNodeHandle,
  NativeModules,
  Text as NativeText,
} from "react-native";

import { useEvent } from "../react/useEvent";
import { productFontStyle } from "../ui/Typography";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";
import { contentReviewNativeModule } from "./content-review-native-module";
import type { ContentReviewHighlight } from "./ContentReviewHost";

export type ReviewSelection = {
  end: number;
  start: number;
  text: string;
};

type NativeSelectionEvent = ReviewSelection & { token?: string };

const callbacks = new Map<string, (selection: ReviewSelection) => void>();
const EMPTY_REVIEW_HIGHLIGHTS: readonly ContentReviewHighlight[] = [];
let nativeSubscription: { remove: () => void } | null = null;

function ensureNativeSubscription(): void {
  if (nativeSubscription !== null) {
    return;
  }
  nativeSubscription = DeviceEventEmitter.addListener(
    "codewideContentReviewSelection",
    (event: NativeSelectionEvent) => {
      if (typeof event.token !== "string" || typeof event.text !== "string") {
        return;
      }
      callbacks.get(event.token)?.({
        end: Number.isFinite(event.end) ? event.end : event.text.length,
        start: Number.isFinite(event.start) ? event.start : 0,
        text: event.text,
      });
    },
  );
}

export function ReviewableText({
  allowFontScaling = true,
  maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
  onReviewSelection,
  reviewHighlights = EMPTY_REVIEW_HIGHLIGHTS,
  style,
  ...props
}: ComponentProps<typeof NativeText> & {
  onReviewSelection: (selection: ReviewSelection) => void;
  reviewHighlights?: readonly ContentReviewHighlight[];
}) {
  const textRef = useRef<ComponentRef<typeof NativeText> | null>(null);
  const generatedId = useId();
  const token = `review-text-${generatedId}`;
  const handleReviewSelection = useEvent(onReviewSelection);
  const highlightKey = reviewHighlights
    .map(({ end, start }) => `${String(start)}:${String(end)}`)
    .join(",");
  const applyReviewHighlights = useEvent(
    (nativeModule: ReturnType<typeof contentReviewNativeModule>, reactTag: number) => {
      nativeModule?.setHighlights?.(reactTag, token, reviewHighlights);
    },
  );

  useLayoutEffect(() => {
    const nativeModule = contentReviewNativeModule(NativeModules.CodeWideContentReview);
    if (nativeModule === null) {
      return undefined;
    }
    const reactTag = findNodeHandle(textRef.current);
    if (reactTag === null) {
      return undefined;
    }
    ensureNativeSubscription();
    callbacks.set(token, (selection) => {
      handleReviewSelection(selection);
    });
    nativeModule.install(reactTag, token);
    return () => {
      callbacks.delete(token);
      nativeModule.uninstall(reactTag, token);
      if (callbacks.size === 0) {
        nativeSubscription?.remove();
        nativeSubscription = null;
      }
    };
  }, [handleReviewSelection, token]);

  useLayoutEffect(() => {
    const nativeModule = contentReviewNativeModule(NativeModules.CodeWideContentReview);
    if (nativeModule?.setHighlights === undefined) {
      return;
    }
    const reactTag = findNodeHandle(textRef.current);
    if (reactTag === null) {
      return;
    }
    applyReviewHighlights(nativeModule, reactTag);
  }, [applyReviewHighlights, highlightKey, token]);

  return (
    <NativeText
      ref={textRef}
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      selectable
      style={[style, productFontStyle(style)]}
    />
  );
}

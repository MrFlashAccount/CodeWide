import type { OnViewableItemsChangedInfo, ViewabilityConfig } from "@legendapp/list/react-native";
import { useRef, type RefObject } from "react";
import type { View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { TimelineDisplayTurn } from "./timelineTypes";

interface LatestAssistantVisibilityInput {
  activityMarker: string | null;
  onVisible?(activityMarker: string): Promise<void> | void;
  turns: TimelineDisplayTurn[];
}

export interface LatestAssistantVisibilityModel {
  latestTurnId: string | null;
  onLayout(): void;
  onViewableItemsChanged(info: OnViewableItemsChangedInfo<TimelineDisplayTurn>): void;
  scheduleMeasurement(): void;
  setLatestAssistantNode(node: View | null): void;
  setViewportNode(node: View | null): void;
}

interface LatestAssistantMeasurement {
  assistantRef: RefObject<View | null>;
  currentActivityMarker(): string | null;
  currentOnVisible(): LatestAssistantVisibilityInput["onVisible"];
  pendingMarkerRef: RefObject<string | null>;
  reportedMarkerRef: RefObject<string | null>;
  retryAfterPendingRef: RefObject<boolean>;
  scheduledRef: RefObject<boolean>;
  viewportRef: RefObject<View | null>;
}

const LATEST_ASSISTANT_VISIBLE_RATIO = 0.3;
export const LATEST_ASSISTANT_VIEWABILITY: ViewabilityConfig = {
  itemVisiblePercentThreshold: 1,
};

export function useLatestAssistantVisibility(
  input: LatestAssistantVisibilityInput,
): LatestAssistantVisibilityModel {
  const { activityMarker, onVisible, turns } = input;
  const viewportRef = useRef<View>(null);
  const assistantRef = useRef<View | null>(null);
  const scheduledRef = useRef(false);
  const pendingMarkerRef = useRef<string | null>(null);
  const reportedMarkerRef = useRef<string | null>(null);
  const retryAfterPendingRef = useRef(false);
  const currentActivityMarker = useEvent(() => activityMarker);
  const currentOnVisible = useEvent(() => onVisible);
  const measurement: LatestAssistantMeasurement = {
    assistantRef,
    currentActivityMarker,
    currentOnVisible,
    pendingMarkerRef,
    reportedMarkerRef,
    retryAfterPendingRef,
    scheduledRef,
    viewportRef,
  };
  const scheduleMeasurement = useEvent(() => scheduleLatestAssistantMeasurement(measurement));
  const setLatestAssistantNode = useEvent((node: View | null) => {
    assistantRef.current = node;
    if (node !== null) scheduleMeasurement();
  });
  const setViewportNode = useEvent((node: View | null) => {
    viewportRef.current = node;
    if (node !== null) scheduleMeasurement();
  });
  const onViewableItemsChanged = useEvent(
    (info: OnViewableItemsChangedInfo<TimelineDisplayTurn>) => {
      const latestTurnId = latestFinalAssistantTurnId(turns);
      if (info.viewableItems.some((token) => token.item.id === latestTurnId)) scheduleMeasurement();
    },
  );
  return {
    latestTurnId: latestFinalAssistantTurnId(turns),
    onLayout: scheduleMeasurement,
    onViewableItemsChanged,
    scheduleMeasurement,
    setLatestAssistantNode,
    setViewportNode,
  };
}

function scheduleLatestAssistantMeasurement(input: LatestAssistantMeasurement): void {
  if (input.scheduledRef.current || input.currentActivityMarker() === null) return;
  input.scheduledRef.current = true;
  requestAnimationFrame(() => {
    input.scheduledRef.current = false;
    measureLatestAssistant(input);
  });
}

function measureLatestAssistant(input: LatestAssistantMeasurement): void {
  const marker = input.currentActivityMarker();
  const viewport = input.viewportRef.current;
  const assistant = input.assistantRef.current;
  if (marker === null || viewport === null || assistant === null) return;
  viewport.measureInWindow((_viewportX, viewportY, _viewportWidth, viewportHeight) => {
    assistant.measureInWindow((_assistantX, assistantY, _assistantWidth, assistantHeight) => {
      if (input.currentActivityMarker() !== marker) return;
      if (!isAssistantVisible(assistantY, assistantHeight, viewportY, viewportHeight)) return;
      reportLatestAssistantVisible(input, marker);
    });
  });
}

function reportLatestAssistantVisible(input: LatestAssistantMeasurement, marker: string): void {
  const onVisible = input.currentOnVisible();
  if (
    onVisible === undefined ||
    input.currentActivityMarker() !== marker ||
    input.reportedMarkerRef.current === marker
  )
    return;
  if (input.pendingMarkerRef.current === marker) {
    input.retryAfterPendingRef.current = true;
    return;
  }
  input.pendingMarkerRef.current = marker;
  Promise.resolve()
    .then(() => onVisible(marker))
    .then(() => {
      input.reportedMarkerRef.current = marker;
      input.pendingMarkerRef.current = null;
    })
    .catch(() => {
      input.pendingMarkerRef.current = null;
      if (!input.retryAfterPendingRef.current) return;
      input.retryAfterPendingRef.current = false;
      scheduleLatestAssistantMeasurement(input);
    });
}

function latestFinalAssistantTurnId(turns: TimelineDisplayTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.state === "completed" && turn.assistantText.length > 0) return turn.id;
  }
  return null;
}

export function isAssistantVisible(
  assistantY: number,
  assistantHeight: number,
  viewportY: number,
  viewportHeight: number,
): boolean {
  if (assistantHeight <= 0 || viewportHeight <= 0) return false;
  const visibleTop = Math.max(assistantY, viewportY);
  const visibleBottom = Math.min(assistantY + assistantHeight, viewportY + viewportHeight);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return (
    visibleHeight / Math.min(assistantHeight, viewportHeight) >= LATEST_ASSISTANT_VISIBLE_RATIO
  );
}

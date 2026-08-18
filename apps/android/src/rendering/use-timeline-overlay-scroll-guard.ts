import { type MutableRefObject, useState } from "react";

import type { ThreadTimelineListRef } from "./ThreadTimelineList";

type TimelineOverlayFreeze = {
  set(value: boolean): void;
};

type TimelineOverlayScrollGuardOptions = {
  listRef: MutableRefObject<ThreadTimelineListRef | null>;
  offsetYRef: MutableRefObject<number | null>;
  viewportHeightRef: MutableRefObject<number>;
  contentHeightRef: MutableRefObject<number>;
  distanceFromEndRef: MutableRefObject<number>;
  freeze: TimelineOverlayFreeze;
};

type TimelineOverlayScrollGuardScheduler = (callback: () => void) => void;

export type TimelineOverlayScrollGuard = {
  begin(id: string): void;
  end(id: string): void;
  observeNativeOffset(offsetY: number): boolean;
  isActive(): boolean;
  reset(): void;
  restore(release: boolean): void;
};

export function timelineOffsetForDistanceFromEnd(
  contentHeight: number,
  viewportHeight: number,
  distanceFromEnd: number,
): number {
  return Math.max(0, contentHeight - viewportHeight - Math.max(0, distanceFromEnd));
}

function scheduleAfterNativeLayout(callback: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

/**
 * Owns the invariant that mounting a native fullscreen surface must not move
 * the timeline underneath it. Android changes window focus while Modal mounts;
 * KeyboardChatScrollView otherwise handles that transition on the UI thread
 * before JavaScript can repair the offset.
 *
 * This controller is intentionally independent from React so its actual
 * open/focus-shift/close behavior can be regression-tested with a deterministic
 * scheduler. The hook below only creates one controller per conversation.
 */
export function createTimelineOverlayScrollGuard(
  {
    listRef,
    offsetYRef,
    viewportHeightRef,
    contentHeightRef,
    distanceFromEndRef,
    freeze,
  }: TimelineOverlayScrollGuardOptions,
  schedule: TimelineOverlayScrollGuardScheduler = scheduleAfterNativeLayout,
): TimelineOverlayScrollGuard {
  const state = {
    active: new Set<string>(),
    anchorOffsetY: null as number | null,
    revision: 0,
  };

  const restore = (release: boolean) => {
    const anchorOffsetY = state.anchorOffsetY;
    state.revision += 1;
    const revision = state.revision;
    if (anchorOffsetY === null) {
      if (release && state.active.size === 0) freeze.set(false);
      return;
    }

    schedule(() => {
      if (state.revision !== revision) return;
      const maxOffset = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
      const offset = Math.min(anchorOffsetY, maxOffset);
      if (release && state.active.size === 0) {
        // KeyboardChatScrollView owns its inset while the conversation is
        // active. A fullscreen modal has no keyboard, so discard any focus
        // transition inset before handing ownership back to it.
        listRef.current?.reportContentInset({ bottom: 0 });
      }
      listRef.current?.scrollToOffset({ offset, animated: false });
      offsetYRef.current = offset;
      distanceFromEndRef.current = Math.max(0, maxOffset - offset);
      if (release && state.active.size === 0) {
        state.anchorOffsetY = null;
        freeze.set(false);
      }
    });
  };

  const begin = (id: string) => {
    if (state.active.has(id)) return;
    if (state.active.size === 0) {
      state.anchorOffsetY = offsetYRef.current ?? timelineOffsetForDistanceFromEnd(
        contentHeightRef.current,
        viewportHeightRef.current,
        distanceFromEndRef.current,
      );
      // Freeze before the native Modal enters the React tree. Ignoring JS
      // onScroll callbacks is too late because the list moves on the UI thread.
      freeze.set(true);
    }
    state.active.add(id);
    restore(false);
  };

  const end = (id: string) => {
    if (!state.active.delete(id)) return;
    if (state.active.size === 0) restore(true);
  };

  const observeNativeOffset = (offsetY: number) => {
    if (state.active.size === 0) return false;
    const anchorOffsetY = state.anchorOffsetY;
    if (anchorOffsetY !== null && Math.abs(offsetY - anchorOffsetY) > 0.5) restore(false);
    return true;
  };

  const isActive = () => state.active.size > 0;

  const reset = () => {
    state.revision += 1;
    state.active.clear();
    state.anchorOffsetY = null;
    freeze.set(false);
  };

  return { begin, end, observeNativeOffset, isActive, reset, restore };
}

export function useTimelineOverlayScrollGuard(options: TimelineOverlayScrollGuardOptions) {
  const [controller] = useState(() => createTimelineOverlayScrollGuard(options));
  return controller;
}

import { setAppNoticeWindowVisible } from "../native/appNoticeWindow";
import type { AppNoticeRequest } from "./appNoticeContext";

export interface NoticeEntry {
  readonly id: number;
  readonly request: AppNoticeRequest;
}

const MAX_NOTICES = 50;
const EXIT_DURATION_MS = 240;
const listeners = new Set<() => void>();
let notices: readonly NoticeEntry[] = [];
let nextId = 0;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

function publish(): void {
  for (const listener of listeners) {
    listener();
  }
}

function cancelWindowHide(): void {
  if (hideTimeout !== null) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
}

/** Process-local notice queue shared by the workspace and Android's second React surface. */
export const appNoticeStore = {
  clear: (): void => {
    cancelWindowHide();
    notices = [];
    setAppNoticeWindowVisible(false);
    publish();
  },
  dismiss: (id: number): void => {
    const next = notices.filter((entry) => entry.id !== id);
    if (next.length === notices.length) {
      return;
    }
    notices = next;
    publish();
    if (notices.length === 0) {
      hideTimeout = setTimeout(() => {
        hideTimeout = null;
        if (notices.length === 0) {
          setAppNoticeWindowVisible(false);
        }
      }, EXIT_DURATION_MS);
    }
  },
  getSnapshot: (): readonly NoticeEntry[] => notices,
  show: (request: AppNoticeRequest): void => {
    cancelWindowHide();
    nextId += 1;
    notices = [{ id: nextId, request }, ...notices].slice(0, MAX_NOTICES);
    setAppNoticeWindowVisible(true);
    publish();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

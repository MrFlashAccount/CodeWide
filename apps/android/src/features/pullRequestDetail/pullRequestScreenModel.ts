/**
 * Interaction state of one PR route session: pending runs, file selection and
 * toggles, the stale-head banner and the last forge refusal. The active tab is
 * route state; this model never copies resource or navigation state.
 */
import { observable, type Observable } from "@legendapp/state";

/** PR screen tab. */
export type PullRequestTab = "changes" | "overview";

/** Notice shown after a write did not happen as asked. */
export type ActionNotice =
  | { readonly actionId: string; readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "stale" }
  | { readonly kind: "outcomeUnknown" }
  | { readonly kind: "message"; readonly text: string };

/** Per-route-session PR screen state. */
export type PullRequestScreenState = {
  readonly changesView: "files" | "guide";
  readonly notice: ActionNotice | null;
  /** Actions whose run is awaiting the companion's acknowledgement. */
  readonly pending: Readonly<Record<string, true>>;
  /** Requested toggle values while their run is pending (shown disabled, label shimmering). */
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly selectedPath: string | null;
};

/** Creates the state owner of one mounted PR screen. */
export function createPullRequestScreenModel(): Observable<PullRequestScreenState> {
  return observable<PullRequestScreenState>({
    changesView: "files",
    notice: null,
    pending: {},
    pendingToggles: {},
    selectedPath: null,
  });
}

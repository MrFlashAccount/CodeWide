/**
 * Interaction state of one PR route session: pending runs, file selection and
 * toggles and review sheet selection. The active tab is
 * route state; this model never copies resource or navigation state.
 */
import { observable, type Observable } from "@legendapp/state";

/** PR screen tab. */
export type PullRequestTab = "changes" | "overview";

/** What the Changes route shows: the file tree with diffs, or the review guide. */
export type ChangesView = "files" | "guide";

/** Per-route-session PR screen state. */
export type PullRequestScreenState = {
  /** Review threads whose focused `addressComments` start awaits the companion. */
  readonly addressingThreads: Readonly<Record<string, true>>;
  readonly changesView: ChangesView;
  /** The Changes file tree panel; `null` follows the form factor (open on tablets). */
  readonly filesPanelOpen: boolean | null;
  /** Actions whose run is awaiting the companion's acknowledgement. */
  readonly pending: Readonly<Record<string, true>>;
  /** Requested toggle values while their run is pending (shown disabled, label shimmering). */
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  /**
   * The verdict the Details Submit review sheet is open with (its opaque `actionId`); `null`
   * while the sheet is closed. Opened from the Details verdict button or the app bar menu.
   */
  readonly reviewVerdict: string | null;
  readonly selectedPath: string | null;
};

/** Creates the state owner of one mounted PR screen; Changes opens on `changesView`. */
export function createPullRequestScreenModel(
  changesView: ChangesView = "files",
): Observable<PullRequestScreenState> {
  return observable<PullRequestScreenState>({
    addressingThreads: {},
    changesView,
    filesPanelOpen: null,
    pending: {},
    pendingToggles: {},
    reviewVerdict: null,
    selectedPath: null,
  });
}

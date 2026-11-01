/**
 * Interaction state of one PR route session: pending runs, file selection and
 * toggles, the stale-head banner and the last forge refusal. The active tab is
 * route state; this model never copies resource or navigation state.
 */
import { observable, type Observable } from "@legendapp/state";

/** PR screen tab. */
export type PullRequestTab = "changes" | "overview";

/** What the Changes route shows: the file tree with diffs, or the review guide. */
export type ChangesView = "files" | "guide";

/** Notice shown after a write did not happen as asked. */
export type ActionNotice =
  | {
      readonly actionId: string;
      readonly kind: "refused";
      readonly reason: string;
    }
  | { readonly kind: "stale" }
  | { readonly kind: "outcomeUnknown" }
  | { readonly kind: "message"; readonly text: string }
  /** An agent scenario's run failed at the shown head; `reason` is the Companion's. */
  | {
      readonly kind: "agentFailed";
      readonly label: string;
      readonly reason: string;
    };

/** Per-route-session PR screen state. */
export type PullRequestScreenState = {
  /** Review threads whose focused `addressComments` start awaits the companion. */
  readonly addressingThreads: Readonly<Record<string, true>>;
  readonly changesView: ChangesView;
  /** The Changes file tree panel; `null` follows the form factor (open on tablets). */
  readonly filesPanelOpen: boolean | null;
  readonly notice: ActionNotice | null;
  /** Actions whose run is awaiting the companion's acknowledgement. */
  readonly pending: Readonly<Record<string, true>>;
  /** Requested toggle values while their run is pending (shown disabled, label shimmering). */
  readonly pendingToggles: Readonly<Record<string, boolean>>;
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
    notice: null,
    pending: {},
    pendingToggles: {},
    selectedPath: null,
  });
}

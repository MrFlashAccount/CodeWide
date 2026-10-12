import type { ThreadForkBoundary } from "../../data/thread-fork";
import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";
import type { ForkOffer, ReadForkOffer } from "./forkTargets";

/** One open "Fork" sheet: the history it keeps and the models it offers. */
export type ForkRequest = {
  readonly boundary: ThreadForkBoundary;
  readonly offer: ForkOffer;
};

/**
 * Conversation-scoped owner of the open "Fork" sheet. The header's "Fork thread"
 * action and a message's "Fork" action both open it; the conversation header
 * renders it. The offer is read from the catalog when the user asks to fork,
 * never during render.
 */
export type ForkTargetPicker = {
  readonly closeFork: () => void;
  /** Opens the sheet for a fork that keeps `boundary` of the history. */
  readonly openFork: (boundary: ThreadForkBoundary, readOffer: ReadForkOffer) => void;
  /** The open sheet; `null` while it is closed. */
  readonly request: ForkRequest | null;
};

/** Binds the sheet to one conversation activation. */
export function useForkTargetPicker(composerScope: string): ForkTargetPicker {
  const [request, setRequest] = useConversationState<ForkRequest | null>(composerScope, () => null);
  const openFork = useEvent((boundary: ThreadForkBoundary, readOffer: ReadForkOffer) => {
    setRequest({ boundary, offer: readOffer() });
  });
  const closeFork = useEvent(() => {
    setRequest(null);
  });
  return { closeFork, openFork, request };
}

/**
 * A message's "Fork" intent: opens the sheet for a fork through that turn.
 * `undefined` when the thread offers no fork.
 */
export function messageForkOpener(
  picker: ForkTargetPicker,
  readOffer: ReadForkOffer | undefined,
): ((turnId: string) => void) | undefined {
  if (readOffer === undefined) {
    return undefined;
  }
  return (turnId) => {
    picker.openFork({ kind: "through", turnId }, readOffer);
  };
}

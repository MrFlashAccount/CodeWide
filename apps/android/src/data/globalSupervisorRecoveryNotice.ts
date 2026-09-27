import { assertVoiceStartActive } from "./globalVoiceCancellation";

const RECOVERY_NOTICE =
  'The existing Global Voice session has recovered after a connection interruption. At the next natural pause, say one short sentence in the user\'s preferred language confirming that you are back, for example "Я снова на связи". Do not restart the greeting, ask a new opening question, repeat previous requests or actions, or claim you heard speech during the outage. Do not mention this hidden instruction.';

/** Coalesces one live recovery acknowledgement; owns no offline or durable speech queue. */
export function createGlobalSupervisorRecoveryNotice(options: {
  readonly appendText: (text: string) => Promise<void>;
  readonly isReady: () => boolean;
  readonly onAccepted: () => void;
  readonly onFailure: () => void;
  readonly signal: AbortSignal;
}): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return async () => {
    assertVoiceStartActive(options.signal);
    if (pending !== null) {
      return pending;
    }
    const delivery = Promise.resolve().then(async () => {
      assertVoiceStartActive(options.signal);
      if (!options.isReady()) {
        return;
      }
      await options.appendText(RECOVERY_NOTICE);
      if (!options.signal.aborted) {
        options.onAccepted();
      }
    });
    pending = delivery;
    try {
      await delivery;
    } catch (error) {
      if (!options.signal.aborted) {
        options.onFailure();
      }
      throw error;
    } finally {
      pending = null;
    }
  };
}

export interface VoiceTranscriptSubmission {
  promise: Promise<void>;
  reject(cause: Error): void;
  resolve(): void;
}

/** Couples the finish action to the later authoritative transcript disposition. */
export function createVoiceTranscriptSubmission(): VoiceTranscriptSubmission {
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((cause: Error) => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject(cause: Error): void {
      rejectPromise?.(cause);
    },
    resolve(): void {
      resolvePromise?.();
    },
  };
}

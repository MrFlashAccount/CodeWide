/** Exclusive V1 microphone owner used for exact-token acquisition and release. */
type V1MicrophoneLeaseOwner =
  | { readonly kind: "dictation"; readonly scope: string }
  | { readonly activationId: string; readonly kind: "globalSupervisor" };

/** Observable microphone arbitration state. */
type V1MicrophoneArbitrationState =
  | { readonly phase: "idle" }
  | {
      readonly assistant: Extract<V1MicrophoneLeaseOwner, { readonly kind: "globalSupervisor" }>;
      readonly phase: "assistantOwned";
    }
  | {
      readonly assistant: Extract<V1MicrophoneLeaseOwner, { readonly kind: "globalSupervisor" }>;
      readonly dictation: Extract<V1MicrophoneLeaseOwner, { readonly kind: "dictation" }>;
      readonly phase: "handoffToDictation";
    }
  | {
      readonly assistant: Extract<
        V1MicrophoneLeaseOwner,
        { readonly kind: "globalSupervisor" }
      > | null;
      readonly dictation: Extract<V1MicrophoneLeaseOwner, { readonly kind: "dictation" }>;
      readonly phase: "dictationOwned";
    }
  | {
      readonly assistant: Extract<V1MicrophoneLeaseOwner, { readonly kind: "globalSupervisor" }>;
      readonly dictation: Extract<V1MicrophoneLeaseOwner, { readonly kind: "dictation" }>;
      readonly phase: "handoffBack";
    };

/** Narrow runtime capability used by the arbiter to suspend and resume one logical activation. */
type V1GlobalSupervisorMicrophoneHandoff = {
  readonly pauseForDictation: () => Promise<void>;
  readonly resumeAfterDictation: () => Promise<void>;
};

/** Acquired microphone lease that only its exact token can release. */
export type V1MicrophoneLease = {
  readonly owner: V1MicrophoneLeaseOwner;
  readonly release: () => Promise<boolean>;
  readonly token: string;
};

/** Result of a microphone acquisition attempt. */
type V1MicrophoneLeaseAcquisition =
  | { readonly lease: V1MicrophoneLease; readonly status: "acquired" }
  | { readonly owner: V1MicrophoneLeaseOwner; readonly status: "busy" };

/** Shared V1 microphone arbitration capability. */
export type V1MicrophoneLeaseRegistry = {
  readonly acquireDictation: (scope: string) => Promise<V1MicrophoneLeaseAcquisition>;
  readonly acquireGlobalSupervisor: (
    activationId: string,
    handoff?: V1GlobalSupervisorMicrophoneHandoff,
  ) => V1MicrophoneLeaseAcquisition;
  readonly currentOwner: () => V1MicrophoneLeaseOwner | null;
  readonly state: () => V1MicrophoneArbitrationState;
};

type AssistantLeaseRecord = {
  readonly handoff: V1GlobalSupervisorMicrophoneHandoff | null;
  readonly owner: Extract<V1MicrophoneLeaseOwner, { readonly kind: "globalSupervisor" }>;
  released: boolean;
  readonly token: string;
};

type DictationLeaseRecord = {
  readonly owner: Extract<V1MicrophoneLeaseOwner, { readonly kind: "dictation" }>;
  readonly token: string;
};

type ArbitrationRecord =
  | { readonly phase: "idle" }
  | { readonly assistant: AssistantLeaseRecord; readonly phase: "assistantOwned" }
  | {
      readonly assistant: AssistantLeaseRecord;
      readonly dictation: DictationLeaseRecord;
      readonly phase: "handoffToDictation";
      readonly result: Promise<V1MicrophoneLeaseAcquisition>;
    }
  | {
      assistant: AssistantLeaseRecord | null;
      readonly dictation: DictationLeaseRecord;
      readonly phase: "dictationOwned";
    }
  | {
      readonly assistant: AssistantLeaseRecord;
      readonly dictation: DictationLeaseRecord;
      readonly phase: "handoffBack";
      readonly result: Promise<boolean>;
    };

function busy(owner: V1MicrophoneLeaseOwner): V1MicrophoneLeaseAcquisition {
  return { owner, status: "busy" };
}

/**
 * Owns the single V1 microphone and serializes Global Voice suspension around
 * ordinary input dictation without ending the logical assistant activation.
 */
export function createV1MicrophoneLeaseRegistry(
  randomUUID: () => string,
): V1MicrophoneLeaseRegistry {
  let current: ArbitrationRecord = { phase: "idle" };
  const readCurrent = (): ArbitrationRecord => current;

  const releaseAssistant = (assistant: AssistantLeaseRecord): boolean => {
    if (assistant.released) {
      return false;
    }
    assistant.released = true;
    if (current.phase === "assistantOwned") {
      if (current.assistant !== assistant) {
        return false;
      }
      current = { phase: "idle" };
      return true;
    }
    if (current.phase === "handoffToDictation") {
      return current.assistant === assistant;
    }
    if (current.phase === "dictationOwned") {
      if (current.assistant !== assistant) {
        return false;
      }
      current.assistant = null;
      return true;
    }
    if (current.phase === "handoffBack") {
      return current.assistant === assistant;
    }
    return false;
  };

  const releaseDictation = async (dictation: DictationLeaseRecord): Promise<boolean> => {
    if (current.phase !== "dictationOwned" || current.dictation !== dictation) {
      return false;
    }
    const assistant = current.assistant;
    const handoff = assistant?.handoff ?? null;
    if (assistant === null || assistant.released || handoff === null) {
      current = { phase: "idle" };
      return true;
    }
    const result = (async (): Promise<boolean> => {
      try {
        await handoff.resumeAfterDictation();
      } finally {
        const settled = readCurrent();
        if (settled.phase === "handoffBack" && settled.assistant === assistant) {
          current = assistant.released ? { phase: "idle" } : { assistant, phase: "assistantOwned" };
        }
      }
      return true;
    })();
    current = { assistant, dictation, phase: "handoffBack", result };
    return result;
  };

  const dictationLease = (dictation: DictationLeaseRecord): V1MicrophoneLease => ({
    owner: dictation.owner,
    release: async () => {
      const released = await releaseDictation(dictation);
      return released;
    },
    token: dictation.token,
  });

  const acquireIdleDictation = (
    owner: DictationLeaseRecord["owner"],
  ): V1MicrophoneLeaseAcquisition => {
    const dictation: DictationLeaseRecord = { owner, token: randomUUID() };
    current = { assistant: null, dictation, phase: "dictationOwned" };
    return { lease: dictationLease(dictation), status: "acquired" };
  };

  // WHY: this boundary must publish handoffToDictation synchronously before returning the retained
  // completion Promise; making the function async would wrap that Promise and hide its identity.
  // oxlint-disable-next-line typescript/promise-function-async
  const beginAssistantHandoff = (
    assistant: AssistantLeaseRecord,
    owner: DictationLeaseRecord["owner"],
  ): Promise<V1MicrophoneLeaseAcquisition> => {
    const handoff = assistant.handoff;
    if (handoff === null) {
      return Promise.resolve(busy(assistant.owner));
    }
    const dictation: DictationLeaseRecord = { owner, token: randomUUID() };
    const result = (async (): Promise<V1MicrophoneLeaseAcquisition> => {
      try {
        await handoff.pauseForDictation();
      } catch (error) {
        const failed = readCurrent();
        if (failed.phase === "handoffToDictation" && failed.assistant === assistant) {
          current = assistant.released ? { phase: "idle" } : { assistant, phase: "assistantOwned" };
        }
        throw error;
      }
      const handedOff = readCurrent();
      if (handedOff.phase !== "handoffToDictation" || handedOff.assistant !== assistant) {
        return busy(owner);
      }
      current = {
        assistant: assistant.released ? null : assistant,
        dictation,
        phase: "dictationOwned",
      };
      return { lease: dictationLease(dictation), status: "acquired" };
    })();
    current = { assistant, dictation, phase: "handoffToDictation", result };
    return result;
  };

  return {
    async acquireDictation(scope) {
      const owner = { kind: "dictation" as const, scope };
      if (current.phase === "idle") {
        return acquireIdleDictation(owner);
      }
      if (current.phase === "handoffToDictation") {
        return current.dictation.owner.scope === scope
          ? current.result
          : busy(current.dictation.owner);
      }
      if (current.phase === "dictationOwned" || current.phase === "handoffBack") {
        return busy(current.dictation.owner);
      }
      const assistant = current.assistant;
      return beginAssistantHandoff(assistant, owner);
    },
    acquireGlobalSupervisor(activationId, handoff) {
      if (current.phase !== "idle") {
        const owner =
          current.phase === "assistantOwned" || current.phase === "handoffToDictation"
            ? current.assistant.owner
            : current.dictation.owner;
        return busy(owner);
      }
      const assistant: AssistantLeaseRecord = {
        handoff: handoff ?? null,
        owner: { activationId, kind: "globalSupervisor" },
        released: false,
        token: randomUUID(),
      };
      current = { assistant, phase: "assistantOwned" };
      return {
        lease: {
          owner: assistant.owner,
          // WHY: all microphone leases expose one async release shape even though this owner has no
          // transport handback to await; consumers must not branch on the owner kind.
          // oxlint-disable-next-line typescript/require-await
          release: async () => releaseAssistant(assistant),
          token: assistant.token,
        },
        status: "acquired",
      };
    },
    currentOwner() {
      if (current.phase === "assistantOwned" || current.phase === "handoffToDictation") {
        return current.assistant.owner;
      }
      if (current.phase === "dictationOwned") {
        return current.dictation.owner;
      }
      return null;
    },
    state() {
      if (current.phase === "assistantOwned") {
        return { assistant: current.assistant.owner, phase: "assistantOwned" };
      }
      if (current.phase === "handoffToDictation") {
        return {
          assistant: current.assistant.owner,
          dictation: current.dictation.owner,
          phase: "handoffToDictation",
        };
      }
      if (current.phase === "dictationOwned") {
        return {
          assistant: current.assistant?.owner ?? null,
          dictation: current.dictation.owner,
          phase: "dictationOwned",
        };
      }
      if (current.phase === "handoffBack") {
        return {
          assistant: current.assistant.owner,
          dictation: current.dictation.owner,
          phase: "handoffBack",
        };
      }
      return { phase: "idle" };
    },
  };
}

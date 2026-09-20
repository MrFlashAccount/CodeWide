type GlobalSupervisorOperationKind = "enter" | "recover" | "start" | "stop";

type GlobalSupervisorOperation = {
  readonly id: symbol;
  readonly kind: GlobalSupervisorOperationKind;
  readonly promise: Promise<void>;
};

/** Serializes public feature actions while exposing the exact in-flight operation. */
export type GlobalSupervisorOperationOwner = {
  readonly current: () => GlobalSupervisorOperation | null;
  readonly run: (kind: GlobalSupervisorOperationKind, task: () => Promise<void>) => Promise<void>;
};

/** Owns one settled public feature operation and duplicate action reuse. */
export function createGlobalSupervisorOperationOwner(): GlobalSupervisorOperationOwner {
  let operation: GlobalSupervisorOperation | null = null;
  return {
    current: () => operation,
    async run(kind, task) {
      const id = Symbol(kind);
      const next: GlobalSupervisorOperation = {
        id,
        kind,
        promise: Promise.resolve()
          .then(task)
          .finally(() => {
            if (operation?.id === id) {
              operation = null;
            }
          }),
      };
      operation = next;
      await next.promise;
    },
  };
}

import { appLogger, type Logger } from "../observability/logger";

/**
 * Per-connection thread interest declared to the native engine.
 *
 * The chat model decides membership; this owner only turns membership changes
 * into ordered full-set declarations and lets window hydration await the
 * declaration that contains its thread. It never adds a thread by itself.
 */
export type ThreadInterestPort = {
  /** Resolves once the declaration containing `threadId` reached the engine. */
  declared: (connectionId: string, threadId: string) => Promise<void>;
  update: (connectionId: string, threadId: string, interested: boolean) => void;
};

type ConnectionInterest = {
  declaration: Promise<void>;
  failed: boolean;
  scheduled: boolean;
  readonly threads: Set<string>;
};

const RESOLVED_DECLARATION = Promise.resolve();

/**
 * Creates the interest port over the engine's full-set declaration method.
 * Each rejected declaration is logged once with its size only, never thread ids.
 */
export function createThreadInterestPort(
  declare: (connectionId: string, threadIds: readonly string[]) => Promise<void>,
  logger: Logger = appLogger,
): ThreadInterestPort {
  const connections = new Map<string, ConnectionInterest>();

  const connection = (connectionId: string): ConnectionInterest => {
    let current = connections.get(connectionId);
    if (current === undefined) {
      current = {
        declaration: RESOLVED_DECLARATION,
        failed: false,
        scheduled: false,
        threads: new Set(),
      };
      connections.set(connectionId, current);
    }
    return current;
  };

  // Starts one declaration of the current set; the record keeps its promise.
  const startDeclaration = (connectionId: string, current: ConnectionInterest): void => {
    current.scheduled = false;
    current.failed = false;
    const threadIds = [...current.threads];
    const declaration = declare(connectionId, threadIds);
    current.declaration = declaration;
    // The single log site: the scheduled wrapper forwards this same rejection.
    declaration.catch((error: unknown) => {
      logger.warnCaught({
        error,
        event: "thread_interest.declare.failed",
        fields: { threads: threadIds.length },
      });
      if (current.declaration === declaration) {
        current.failed = true;
      }
    });
  };

  // Changes made in one task collapse into a single declaration of the set.
  const schedule = (connectionId: string, current: ConnectionInterest): void => {
    if (current.scheduled) {
      return;
    }
    current.scheduled = true;
    const scheduled = new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        startDeclaration(connectionId, current);
        current.declaration.then(resolve, reject);
      });
    });
    current.declaration = scheduled;
    // Already logged by the declaration it forwards.
    scheduled.catch(() => undefined);
  };

  return {
    async declared(connectionId, threadId) {
      const current = connections.get(connectionId);
      if (current?.threads.has(threadId) !== true) {
        return;
      }
      // A failed declaration is retried by the hydration that needs it.
      if (current.failed) {
        startDeclaration(connectionId, current);
      }
      await current.declaration;
    },
    update(connectionId, threadId, interested) {
      const current = connection(connectionId);
      if (current.threads.has(threadId) === interested) {
        return;
      }
      if (interested) {
        current.threads.add(threadId);
      } else {
        current.threads.delete(threadId);
      }
      schedule(connectionId, current);
    },
  };
}

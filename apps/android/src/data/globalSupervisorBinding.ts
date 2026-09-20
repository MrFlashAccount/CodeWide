export const GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION = 1;
export const GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX = "codewide-global-supervisor:";

declare const globalSupervisorConnectionIdBrand: unique symbol;
declare const globalSupervisorThreadIdBrand: unique symbol;

/** Validated V1 connection identity at the global-supervisor boundary. */
type GlobalSupervisorConnectionId = string & {
  readonly [globalSupervisorConnectionIdBrand]: true;
};

/** Validated V1 thread identity at the global-supervisor boundary. */
type GlobalSupervisorThreadId = string & {
  readonly [globalSupervisorThreadIdBrand]: true;
};

/** Exact qualified chat identity; neither identifier may be substituted for the other. */
export type GlobalSupervisorQualifiedChatRef = {
  readonly connectionId: GlobalSupervisorConnectionId;
  readonly threadId: GlobalSupervisorThreadId;
};

/** Durable crash-recovery state for the one hidden supervisor home thread. */
export type GlobalSupervisorBinding =
  | {
      readonly creationToken: string;
      readonly homeConnectionId: GlobalSupervisorConnectionId;
      readonly schemaVersion: 1;
      readonly status: "creating";
    }
  | {
      readonly home: GlobalSupervisorQualifiedChatRef;
      readonly schemaVersion: 1;
      readonly status: "ready";
    }
  | {
      readonly priorHome: GlobalSupervisorQualifiedChatRef | null;
      readonly reason: "ambiguousCreation" | "homeDeleted" | "malformedStorage";
      readonly schemaVersion: 1;
      readonly status: "invalid";
    };

export type GlobalSupervisorBindingDatabase = {
  readonly clear: () => Promise<void>;
  readonly read: () => Promise<GlobalSupervisorBinding | null>;
  readonly ready: Promise<void>;
  readonly write: (binding: GlobalSupervisorBinding) => Promise<void>;
};

type GlobalSupervisorBindingRemote = {
  readonly findThreadsBySource: (
    connectionId: GlobalSupervisorConnectionId,
    source: string,
  ) => Promise<readonly string[]>;
  readonly startThread: (
    connectionId: GlobalSupervisorConnectionId,
    source: string,
  ) => Promise<string>;
};

export type GlobalSupervisorBindingOwner = {
  readonly bind: (connectionId: string) => Promise<GlobalSupervisorQualifiedChatRef>;
  readonly invalidateDeletedConnections: (connectionIds: ReadonlySet<string>) => Promise<void>;
  readonly read: () => Promise<GlobalSupervisorBinding | null>;
  readonly reconcile: () => Promise<GlobalSupervisorBinding | null>;
  readonly reset: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGlobalSupervisorConnectionId(value: unknown): GlobalSupervisorConnectionId | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  // WHY: Runtime validation above proves the non-empty external identifier; the brand has no runtime representation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as GlobalSupervisorConnectionId;
}

function parseGlobalSupervisorThreadId(value: unknown): GlobalSupervisorThreadId | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  // WHY: Runtime validation above proves the non-empty external identifier; the brand has no runtime representation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as GlobalSupervisorThreadId;
}

export function parseGlobalSupervisorQualifiedChatRef(
  value: unknown,
): GlobalSupervisorQualifiedChatRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const connectionId = parseGlobalSupervisorConnectionId(value.connectionId);
  const threadId = parseGlobalSupervisorThreadId(value.threadId);
  return connectionId !== null && threadId !== null ? { connectionId, threadId } : null;
}

/** Validates a qualified identity at a typed composition boundary. */
export function globalSupervisorQualifiedChatRef(
  connectionId: string,
  threadId: string,
): GlobalSupervisorQualifiedChatRef {
  const ref = parseGlobalSupervisorQualifiedChatRef({ connectionId, threadId });
  if (ref === null) {
    throw new Error("The qualified supervisor chat reference is invalid");
  }
  return ref;
}

function parseCreatingBinding(
  value: Readonly<Record<string, unknown>>,
): Extract<GlobalSupervisorBinding, { readonly status: "creating" }> | null {
  const homeConnectionId = parseGlobalSupervisorConnectionId(value.homeConnectionId);
  if (
    typeof value.creationToken !== "string" ||
    value.creationToken.length === 0 ||
    homeConnectionId === null
  ) {
    return null;
  }
  return {
    creationToken: value.creationToken,
    homeConnectionId,
    schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
    status: "creating",
  };
}

function parseReadyBinding(
  value: Readonly<Record<string, unknown>>,
): Extract<GlobalSupervisorBinding, { readonly status: "ready" }> | null {
  const home = parseGlobalSupervisorQualifiedChatRef(value.home);
  return home === null
    ? null
    : { home, schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION, status: "ready" };
}

function isInvalidReason(
  value: unknown,
): value is Extract<GlobalSupervisorBinding, { readonly status: "invalid" }>["reason"] {
  return value === "ambiguousCreation" || value === "homeDeleted" || value === "malformedStorage";
}

function parseInvalidBinding(
  value: Readonly<Record<string, unknown>>,
): Extract<GlobalSupervisorBinding, { readonly status: "invalid" }> | null {
  if (!isInvalidReason(value.reason)) {
    return null;
  }
  const priorHome =
    value.priorHome === null ? null : parseGlobalSupervisorQualifiedChatRef(value.priorHome);
  if (value.priorHome !== null && priorHome === null) {
    return null;
  }
  return {
    priorHome,
    reason: value.reason,
    schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
    status: "invalid",
  };
}

/** Validates the durable row before it becomes an internal binding. */
export function parseGlobalSupervisorBinding(value: unknown): GlobalSupervisorBinding | null {
  if (!isRecord(value) || value.schemaVersion !== GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION) {
    return null;
  }
  switch (value.status) {
    case "creating":
      return parseCreatingBinding(value);
    case "invalid":
      return parseInvalidBinding(value);
    case "ready":
      return parseReadyBinding(value);
    default:
      return null;
  }
}

type GlobalSupervisorBindingOwnerOptions = {
  readonly database: GlobalSupervisorBindingDatabase;
  readonly randomUUID: () => string;
  readonly remote: GlobalSupervisorBindingRemote;
};

type ExistingBindingResolution =
  | { readonly status: "create" }
  | { readonly home: GlobalSupervisorQualifiedChatRef; readonly status: "ready" };

type CreatingBinding = Extract<GlobalSupervisorBinding, { readonly status: "creating" }>;

async function reconcileCreatingBinding(
  options: GlobalSupervisorBindingOwnerOptions,
  binding: CreatingBinding,
): Promise<GlobalSupervisorBinding> {
  const source = `${GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX}${binding.creationToken}`;
  const threadIds = await options.remote.findThreadsBySource(binding.homeConnectionId, source);
  if (threadIds.length === 0) {
    return binding;
  }
  if (threadIds.length > 1) {
    const invalid: GlobalSupervisorBinding = {
      priorHome: null,
      reason: "ambiguousCreation",
      schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
      status: "invalid",
    };
    await options.database.write(invalid);
    return invalid;
  }
  const threadId = parseGlobalSupervisorThreadId(threadIds[0]);
  if (threadId === null) {
    throw new Error("Supervisor reconciliation returned an invalid thread id");
  }
  const ready: GlobalSupervisorBinding = {
    home: { connectionId: binding.homeConnectionId, threadId },
    schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
    status: "ready",
  };
  await options.database.write(ready);
  return ready;
}

async function resolveExistingBinding(
  options: GlobalSupervisorBindingOwnerOptions,
  connectionId: GlobalSupervisorConnectionId,
): Promise<ExistingBindingResolution> {
  const current = await options.database.read();
  if (current === null) {
    return { status: "create" };
  }
  if (current.status === "ready") {
    if (current.home.connectionId !== connectionId) {
      throw new Error("The supervisor is already bound to another home server");
    }
    return { home: current.home, status: "ready" };
  }
  if (current.status === "invalid") {
    throw new Error("The supervisor binding requires an explicit recovery action");
  }
  if (current.homeConnectionId !== connectionId) {
    throw new Error("The supervisor creation belongs to another home server");
  }
  const reconciled = await reconcileCreatingBinding(options, current);
  if (reconciled.status === "ready") {
    return { home: reconciled.home, status: "ready" };
  }
  if (reconciled.status === "invalid") {
    throw new Error("Supervisor binding is ambiguous and requires an explicit reset");
  }
  throw new Error("The supervisor creation outcome requires explicit reconciliation");
}

async function createBinding(
  options: GlobalSupervisorBindingOwnerOptions,
  connectionId: GlobalSupervisorConnectionId,
): Promise<GlobalSupervisorQualifiedChatRef> {
  const creationToken = options.randomUUID();
  const creating: GlobalSupervisorBinding = {
    creationToken,
    homeConnectionId: connectionId,
    schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
    status: "creating",
  };
  await options.database.write(creating);
  const threadId = parseGlobalSupervisorThreadId(
    await options.remote.startThread(
      connectionId,
      `${GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX}${creationToken}`,
    ),
  );
  if (threadId === null) {
    throw new Error("Supervisor creation returned an invalid thread id");
  }
  const ready: GlobalSupervisorBinding = {
    home: { connectionId, threadId },
    schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
    status: "ready",
  };
  await options.database.write(ready);
  return ready.home;
}

function boundConnectionId(binding: GlobalSupervisorBinding | null): string | null {
  if (binding?.status === "ready") {
    return binding.home.connectionId;
  }
  return binding?.status === "creating" ? binding.homeConnectionId : null;
}

/** Owns crash-safe binding creation and exact-token reconciliation. */
export function createGlobalSupervisorBindingOwner(
  options: GlobalSupervisorBindingOwnerOptions,
): GlobalSupervisorBindingOwner {
  let writeQueue: Promise<void> = Promise.resolve();
  const serialize = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const previous = writeQueue;
    const completion = previous.then(operation);
    writeQueue = completion.then(
      () => undefined,
      () => undefined,
    );
    return completion;
  };

  return {
    async bind(connectionId) {
      return serialize(async () => {
        await options.database.ready;
        const validatedId = parseGlobalSupervisorConnectionId(connectionId);
        if (validatedId === null) {
          throw new Error("The supervisor home server id is invalid");
        }
        const existing = await resolveExistingBinding(options, validatedId);
        return existing.status === "ready" ? existing.home : createBinding(options, validatedId);
      });
    },
    async invalidateDeletedConnections(connectionIds) {
      await serialize(async () => {
        const current = await options.database.read();
        const connectionId = boundConnectionId(current);
        if (connectionId === null || connectionIds.has(connectionId)) {
          return;
        }
        await options.database.write({
          priorHome: current?.status === "ready" ? current.home : null,
          reason: "homeDeleted",
          schemaVersion: GLOBAL_SUPERVISOR_BINDING_SCHEMA_VERSION,
          status: "invalid",
        });
      });
    },
    async read() {
      await options.database.ready;
      return options.database.read();
    },
    async reconcile() {
      return serialize(async () => {
        await options.database.ready;
        const current = await options.database.read();
        return current?.status === "creating"
          ? reconcileCreatingBinding(options, current)
          : current;
      });
    },
    async reset() {
      await serialize(async () => options.database.clear());
    },
  };
}

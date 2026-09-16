export type ConnectionId = {
  readonly kind: "connectionId";
  readonly value: string;
};

export type ThreadId = {
  readonly kind: "threadId";
  readonly value: string;
};

export type TurnId = {
  readonly kind: "turnId";
  readonly value: string;
};

export type RouteSessionId = {
  readonly kind: "routeSessionId";
  readonly value: string;
};

export type RouteParamResult<Value> =
  | { readonly status: "valid"; readonly value: Value }
  | { readonly status: "invalid" };

type RouteParamKind =
  | ConnectionId["kind"]
  | ThreadId["kind"]
  | TurnId["kind"]
  | RouteSessionId["kind"];

// Locally generated session identifiers stay bounded before registry access.
const MAX_ROUTE_PARAM_LENGTH = 1024;

function externalIdParamValue(
  input: string | readonly string[] | undefined,
  kind: RouteParamKind,
): RouteParamResult<{ readonly kind: RouteParamKind; readonly value: string }> {
  if (typeof input !== "string" || input.length === 0) {
    return { status: "invalid" };
  }
  return { status: "valid", value: { kind, value: input } };
}

function routeSessionParamValue(
  input: string | readonly string[] | undefined,
): RouteParamResult<{ readonly kind: "routeSessionId"; readonly value: string }> {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > MAX_ROUTE_PARAM_LENGTH ||
    input.includes("/") ||
    // WHY: Locally generated route-session identifiers contain no ASCII control characters.
    // oxlint-disable-next-line eslint/no-control-regex
    /[\u0000-\u001F\u007F]/u.test(input)
  ) {
    return { status: "invalid" };
  }
  return { status: "valid", value: { kind: "routeSessionId", value: input } };
}

/** Validates one V1 connection route segment before service access. */
export function connectionIdParam(
  input: string | readonly string[] | undefined,
): RouteParamResult<ConnectionId> {
  const result = externalIdParamValue(input, "connectionId");
  return result.status === "invalid"
    ? result
    : { status: "valid", value: { kind: "connectionId", value: result.value.value } };
}

/** Validates one V1 thread route segment before service access. */
export function threadIdParam(
  input: string | readonly string[] | undefined,
): RouteParamResult<ThreadId> {
  const result = externalIdParamValue(input, "threadId");
  return result.status === "invalid"
    ? result
    : { status: "valid", value: { kind: "threadId", value: result.value.value } };
}

/** Validates one V1 turn route segment before service access. */
export function turnIdParam(
  input: string | readonly string[] | undefined,
): RouteParamResult<TurnId> {
  const result = externalIdParamValue(input, "turnId");
  return result.status === "invalid"
    ? result
    : { status: "valid", value: { kind: "turnId", value: result.value.value } };
}

/** Validates one opaque V1 route-session id before registry access. */
export function routeSessionIdParam(
  input: string | readonly string[] | undefined,
): RouteParamResult<RouteSessionId> {
  const result = routeSessionParamValue(input);
  return result.status === "invalid"
    ? result
    : { status: "valid", value: { kind: "routeSessionId", value: result.value.value } };
}

export type V1ThreadRouteParams = {
  readonly connectionId: ConnectionId;
  readonly threadId: ThreadId;
};

export type V1RouteSessionOwner =
  | { readonly kind: "workspace" }
  | { readonly draftId: string; readonly kind: "draft" }
  | { readonly kind: "thread"; readonly thread: V1ThreadRouteParams };

export const workspaceRouteSessionOwner: V1RouteSessionOwner = { kind: "workspace" };

/** Qualifies one private draft activation without exposing it in the URL. */
export function draftRouteSessionOwner(draftId: string): V1RouteSessionOwner {
  return { draftId, kind: "draft" };
}

/** Qualifies one private child activation by its validated parent thread route. */
export function threadRouteSessionOwner(thread: V1ThreadRouteParams): V1RouteSessionOwner {
  return { kind: "thread", thread };
}

/** Compares validated route-session owners without weakening their branded identities. */
export function sameRouteSessionOwner(
  left: V1RouteSessionOwner,
  right: V1RouteSessionOwner,
): boolean {
  if (left.kind === "workspace") {
    return right.kind === "workspace";
  }
  if (left.kind === "draft") {
    return right.kind === "draft" && left.draftId === right.draftId;
  }
  if (right.kind === "thread") {
    return (
      left.thread.connectionId.value === right.thread.connectionId.value &&
      left.thread.threadId.value === right.thread.threadId.value
    );
  }
  return false;
}

export type SelectWorkspaceThread = (selectionKey: string | null) => void;

const THREAD_SELECTION_LENGTH_SEPARATOR = ":";

/** Encodes an internal list selection key without making it a route parameter. */
export function threadSelectionKey(input: {
  readonly id: string;
  readonly serverId: string;
}): string {
  return `${String(input.serverId.length)}${THREAD_SELECTION_LENGTH_SEPARATOR}${input.serverId}${input.id}`;
}

function selectionConnectionLength(value: string): number | null {
  const separator = value.indexOf(THREAD_SELECTION_LENGTH_SEPARATOR);
  if (separator <= 0) {
    return null;
  }
  const encodedLength = value.slice(0, separator);
  if (!/^[1-9]\d*$/u.test(encodedLength)) {
    return null;
  }
  const length = Number(encodedLength);
  return Number.isSafeInteger(length) ? length : null;
}

/** Decodes an internal list selection key into validated V1 route parameters. */
export function parseThreadSelectionKey(value: string | null): V1ThreadRouteParams | null {
  if (value === null) {
    return null;
  }
  const connectionLength = selectionConnectionLength(value);
  if (connectionLength === null) {
    return null;
  }
  const separator = value.indexOf(THREAD_SELECTION_LENGTH_SEPARATOR);
  const connectionStart = separator + 1;
  const connectionEnd = connectionStart + connectionLength;
  if (connectionEnd >= value.length) {
    return null;
  }
  const connection = connectionIdParam(value.slice(connectionStart, connectionEnd));
  const thread = threadIdParam(value.slice(connectionEnd));
  return connection.status === "valid" && thread.status === "valid"
    ? { connectionId: connection.value, threadId: thread.value }
    : null;
}

/** Validates the complete qualified V1 thread identity atomically. */
export function v1ThreadRouteParams(input: {
  readonly connectionId?: string | readonly string[];
  readonly threadId?: string | readonly string[];
}): RouteParamResult<V1ThreadRouteParams> {
  const connection = connectionIdParam(input.connectionId);
  const thread = threadIdParam(input.threadId);
  if (connection.status === "invalid" || thread.status === "invalid") {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    value: { connectionId: connection.value, threadId: thread.value },
  };
}

export type V1ThreadDestination = {
  readonly params: { readonly connectionId: string; readonly threadId: string };
  readonly pathname: "/v1/threads/[connectionId]/[threadId]";
};

/** Builds the canonical qualified V1 thread destination. */
export function v1ThreadDestination(params: V1ThreadRouteParams): V1ThreadDestination {
  return {
    params: {
      connectionId: params.connectionId.value,
      threadId: params.threadId.value,
    },
    pathname: "/v1/threads/[connectionId]/[threadId]",
  };
}

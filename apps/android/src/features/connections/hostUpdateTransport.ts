import { companionHttpUrl } from "../../data/companion-http-url";
import type { StoredConnection } from "../../data/connection-profile-types";
import type {
  CompanionConnectionTransport,
  CompanionTransportInit,
} from "../../native/companionTransportContract";
import {
  parseApplyHostUpdateAccepted,
  parseHostUpdateOperation,
  parseHostUpdateStatus,
  type ApplyHostUpdateAccepted,
  type HostUpdateOperation,
  type HostUpdateStatus,
} from "./hostUpdateContract";

const UNAUTHORIZED_STATUS = 401;
const MAX_ERROR_MESSAGE_LENGTH = 320;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

/** Narrow private HTTP operations consumed by the Connections resource. */
export type HostUpdateTransport = {
  readonly apply: (
    connectionId: string,
    targetFingerprint: string,
    idempotencyKey: string,
  ) => Promise<ApplyHostUpdateAccepted>;
  readonly check: (connectionId: string) => Promise<HostUpdateStatus>;
  readonly readOperation: (
    connectionId: string,
    operationId: string,
  ) => Promise<HostUpdateOperation>;
  readonly readStatus: (connectionId: string) => Promise<HostUpdateStatus>;
  readonly reconnect: (connectionId: string, operationId: string) => Promise<HostUpdateOperation>;
};

/** Structured non-success response from the authenticated host-update API. */
export class HostUpdateHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HostUpdateHttpError";
    this.code = code;
    this.status = status;
  }
}

type HostUpdateTransportAuthority = {
  readonly connectionTransport: (connection: StoredConnection) => CompanionConnectionTransport;
  readonly currentConnections: () => StoredConnection[];
  readonly scopedHttpAuthorization: (
    connection: StoredConnection,
    forceRefresh?: boolean,
  ) => Promise<string>;
};

/** Uses the platform Companion transport and refreshable device session. */
export function createHostUpdateTransport(
  authority: HostUpdateTransportAuthority,
  {
    basePath = "/v1/host-update",
    parseStatus = parseHostUpdateStatus,
    requestTimeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
    subject = "Companion",
  }: {
    readonly basePath?: string;
    readonly parseStatus?: (value: unknown) => HostUpdateStatus;
    readonly requestTimeoutMilliseconds?: number;
    readonly subject?: string;
  } = {},
): HostUpdateTransport {
  const request = async ({
    connectionId,
    init,
    path,
    signal,
  }: {
    readonly connectionId: string;
    readonly init: CompanionTransportInit | undefined;
    readonly path: string;
    readonly signal: AbortSignal;
  }) => {
    const connection = authority
      .currentConnections()
      .find((candidate) => candidate.id === connectionId);
    if (connection === undefined || !connection.enabled) {
      throw new Error("Connection is disabled or missing");
    }
    const { baseUrl, transport } = authority.connectionTransport(connection);
    requireActiveRequest(signal, subject);
    const send = async (forceRefresh: boolean) => {
      const headers = new Headers(init?.headers);
      headers.set(
        "authorization",
        await authority.scopedHttpAuthorization(connection, forceRefresh),
      );
      requireActiveRequest(signal, subject);
      return transport.fetch(companionHttpUrl(baseUrl, path), {
        ...init,
        headers,
        signal,
      });
    };
    let response = await send(false);
    if (response.status === UNAUTHORIZED_STATUS) {
      response = await send(true);
    }
    if (!response.ok) {
      throw await responseError(response, subject);
    }
    return response;
  };

  const jsonRequest = async (
    connectionId: string,
    path: string,
    init?: CompanionTransportInit,
  ): Promise<unknown> => {
    const controller = new AbortController();
    const expired = Promise.withResolvers<never>();
    const timer = setTimeout(() => {
      controller.abort();
      expired.reject(new Error(`Could not read ${subject} update status in time. Try again.`));
    }, requestTimeoutMilliseconds);
    try {
      // Native origin/session resolution and body reading can hang too. Bound
      // the complete request, while aborting fetch and fencing any late send.
      return await Promise.race([
        request({ connectionId, init, path, signal: controller.signal }).then(async (response) => {
          const value: unknown = await response.json();
          return value;
        }),
        expired.promise,
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async apply(connectionId, targetFingerprint, idempotencyKey) {
      return parseApplyHostUpdateAccepted(
        await jsonRequest(connectionId, `${basePath}/apply`, {
          body: JSON.stringify({ idempotencyKey, targetFingerprint }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    },
    async check(connectionId) {
      return parseStatus(await jsonRequest(connectionId, `${basePath}/check`, { method: "POST" }));
    },
    async readOperation(connectionId, operationId) {
      return parseHostUpdateOperation(
        await jsonRequest(
          connectionId,
          `${basePath}/operations/${encodeURIComponent(operationId)}`,
        ),
      );
    },
    async readStatus(connectionId) {
      return parseStatus(await jsonRequest(connectionId, basePath));
    },
    async reconnect(connectionId, operationId) {
      return parseHostUpdateOperation(
        await jsonRequest(
          connectionId,
          `${basePath}/operations/${encodeURIComponent(operationId)}/reconnect`,
          { method: "POST" },
        ),
      );
    },
  };
}

function requireActiveRequest(signal: AbortSignal, subject: string): void {
  if (signal.aborted) {
    throw new Error(`${subject} update request timed out`);
  }
}

async function responseError(response: Response, subject: string): Promise<HostUpdateHttpError> {
  const fallback = `${subject} update request failed (${String(response.status)})`;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const row = body;
      if (typeof row.error === "string" && typeof row.message === "string") {
        return new HostUpdateHttpError(
          response.status,
          row.error,
          sanitizeMessage(row.message, subject),
        );
      }
    }
  } catch {
    // A legacy host may return an HTML or empty 404. Status remains authoritative.
  }
  return new HostUpdateHttpError(response.status, "http_error", fallback);
}

function sanitizeMessage(message: string, subject: string): string {
  const compact = message.replaceAll(/\s+/gu, " ").trim().slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return compact.length === 0 ? `${subject} rejected the update request` : compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

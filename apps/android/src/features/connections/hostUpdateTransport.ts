import { companionHttpUrl } from "../../data/companion-http-url";
import type { StoredConnection } from "../../data/connection-profile-types";
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
  readonly currentConnections: () => StoredConnection[];
  readonly nativeCompanionHttpOrigin: (connectionId: string, endpoint: string) => Promise<string>;
  readonly scopedHttpAuthorization: (
    connection: StoredConnection,
    forceRefresh?: boolean,
  ) => Promise<string>;
};

/** Uses the existing pinned native HTTP origin and refreshable device session. */
export function createHostUpdateTransport(
  authority: HostUpdateTransportAuthority,
  {
    basePath = "/v1/host-update",
    parseStatus = parseHostUpdateStatus,
    subject = "Companion",
  }: {
    readonly basePath?: string;
    readonly parseStatus?: (value: unknown) => HostUpdateStatus;
    readonly subject?: string;
  } = {},
): HostUpdateTransport {
  const request = async (connectionId: string, path: string, init?: RequestInit) => {
    const connection = authority
      .currentConnections()
      .find((candidate) => candidate.id === connectionId);
    if (connection === undefined || !connection.enabled) {
      throw new Error("Connection is disabled or missing");
    }
    const origin = await authority.nativeCompanionHttpOrigin(connection.id, connection.endpoint);
    const send = async (forceRefresh: boolean) => {
      const headers = new Headers(init?.headers);
      headers.set(
        "authorization",
        await authority.scopedHttpAuthorization(connection, forceRefresh),
      );
      return fetch(companionHttpUrl(origin, path), {
        ...init,
        headers,
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
    init?: RequestInit,
  ): Promise<unknown> => {
    const value: unknown = await (await request(connectionId, path, init)).json();
    return value;
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

/** A request body the platform transport sends without copying file bytes through JavaScript. */
export type CompanionTransportBody =
  | string
  | {
      readonly kind: "file";
      readonly length: number;
      readonly offset: number;
      readonly uri: string;
    };

/** Request options shared by the platform and native Companion transports. */
export type CompanionTransportInit = {
  readonly body?: CompanionTransportBody;
  readonly headers?: HeadersInit;
  readonly method?: string;
  readonly signal?: AbortSignal;
};

/** Request headers and cancellation for a download into a file. */
type CompanionTransportDownloadInit = {
  readonly headers: Record<string, string>;
  readonly signal?: AbortSignal | undefined;
};

/** `append` continues a ranged download into an existing file; otherwise the file is replaced. */
type CompanionTransportDestination = { readonly append: boolean; readonly uri: string };

/** Status and headers of a download; a successful body is already in the destination file. */
type CompanionTransportDownload = { readonly headers: Headers; readonly status: number };

/**
 * Moves bytes to one HTTP origin. URLs passed to a transport are the addresses
 * issued together with it; callers never assume they are reachable elsewhere.
 */
export type CompanionTransport = {
  /** Writes a successful body to `destination`; a failed response leaves it untouched. */
  readonly download: (
    uri: string,
    init: CompanionTransportDownloadInit,
    destination: CompanionTransportDestination,
  ) => Promise<CompanionTransportDownload>;
  /** Returns a response for text, JSON and header-only exchanges. Binary bodies use `download`. */
  readonly fetch: (uri: string, init?: CompanionTransportInit) => Promise<Response>;
  /** Resolves a source that a native image or media view can open by itself. */
  readonly streamSource: (
    uri: string,
    headers: Record<string, string>,
  ) => Promise<{ headers: Record<string, string>; uri: string }>;
};

/** The transport and its address space for one saved Companion connection. */
export type CompanionConnectionTransport = {
  readonly baseUrl: string;
  readonly transport: CompanionTransport;
};

const SWITCHING_PROTOCOLS = 101;
const EARLY_HINTS = 103;
const NO_CONTENT = 204;
const RESET_CONTENT = 205;
const NOT_MODIFIED = 304;
const NULL_BODY_STATUSES = new Set([
  SWITCHING_PROTOCOLS,
  EARLY_HINTS,
  NO_CONTENT,
  RESET_CONTENT,
  NOT_MODIFIED,
]);

/** Builds a WHATWG response; null-body statuses and header-only exchanges carry no body. */
export function transportResponse(status: number, headers: Headers, text: string | null): Response {
  return new Response(NULL_BODY_STATUSES.has(status) ? null : text, { headers, status });
}

import { checkAborted } from "../native/check-aborted";
import type {
  DirectImageRequest,
  DirectImageResult,
} from "../native/attachment-cache/transfer-options";
import type { DirectImageGrant, DirectImageSources } from "./directImageSources";

/** Reads one direct image: the shared disk cache first, then its URL. */
type DirectImageReader = (request: DirectImageRequest) => Promise<DirectImageResult>;

/** Status reported when a fresh grant could not be obtained; not retried automatically. */
const GONE_STATUS = 410;

/**
 * A direct image is unavailable. `status` is the HTTP status (or 410 when no fresh grant
 * exists), so the resource store does not retry a refused URL by itself.
 */
export class DirectImageUnavailableError extends Error {
  readonly status: number;

  constructor(status: number, options?: ErrorOptions) {
    super(`Direct image unavailable (${String(status)})`, options);
    this.name = "DirectImageUnavailableError";
    this.status = status;
  }
}

/** One direct image load: the grant, its owner and the cache reader. */
type DirectImageLoad = {
  readonly grant: DirectImageGrant;
  readonly now: () => number;
  readonly read: DirectImageReader;
  readonly reference: string;
  readonly signal: AbortSignal;
  readonly sources: Pick<DirectImageSources, "cacheScope" | "renew">;
};

type DirectImageFailure = Exclude<DirectImageResult, { readonly status: "ready" }>;

/**
 * Loads one granted image. A cached copy answers regardless of expiry. Without one, a grant
 * that has expired by the phone's clock is not fetched; an expiring grant that is missing
 * or refused (4xx) is renewed through its owner exactly once and the fresh URL is tried
 * unconditionally, since the phone's clock may be off. A non-expiring grant is never renewed.
 */
export async function loadDirectImage(load: DirectImageLoad): Promise<{ readonly uri: string }> {
  const { grant, now } = load;
  const expired = grant.expiresAtMs !== null && grant.expiresAtMs <= now();
  const first = await readGrant(load, grant, expired ? null : grant.url);
  if (first.status === "ready") {
    return { uri: first.uri };
  }
  if (grant.expiresAtMs === null || !renewable(first)) {
    throw new DirectImageUnavailableError(failureStatus(first));
  }
  const renewed = await renewGrant(load);
  const second = await readGrant(load, renewed, renewed.url);
  if (second.status === "ready") {
    return { uri: second.uri };
  }
  throw new DirectImageUnavailableError(failureStatus(second));
}

async function readGrant(
  load: DirectImageLoad,
  grant: DirectImageGrant,
  uri: string | null,
): Promise<DirectImageResult> {
  return load.read({
    identity: grant.identity,
    scope: load.sources.cacheScope,
    signal: load.signal,
    uri,
  });
}

/** The owner's fresh grant; a failed or empty renewal ends the load without a retry. */
async function renewGrant(load: DirectImageLoad): Promise<DirectImageGrant> {
  let renewed: DirectImageGrant | null;
  try {
    renewed = await load.sources.renew(load.reference, load.grant);
  } catch (error) {
    checkAborted(load.signal);
    throw new DirectImageUnavailableError(GONE_STATUS, { cause: error });
  }
  checkAborted(load.signal);
  if (renewed === null) {
    throw new DirectImageUnavailableError(GONE_STATUS);
  }
  return renewed;
}

const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;

/** An expired signed URL answers with a client error; a server error is not the URL's fault. */
function renewable(result: DirectImageFailure): boolean {
  return (
    result.status === "missing" ||
    (result.httpStatus >= CLIENT_ERROR_MIN && result.httpStatus < SERVER_ERROR_MIN)
  );
}

function failureStatus(result: DirectImageFailure): number {
  return result.status === "missing" ? GONE_STATUS : result.httpStatus;
}

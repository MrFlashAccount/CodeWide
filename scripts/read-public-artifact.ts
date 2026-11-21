import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const DOWNLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_SOCKET",
]);

type PublicArtifact = {
  readonly contentEncoding: string | null;
  readonly sha256: string;
};

/** Read and hash the whole public artifact, restarting interrupted transfers from zero. */
export async function readPublicArtifact(
  url: URL,
  headers: Readonly<Record<string, string>>,
): Promise<PublicArtifact> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await readArtifactAttempt(url, headers);
    } catch (error) {
      if (attempt >= DOWNLOAD_ATTEMPTS || !isTransientDownloadError(error)) throw error;
      process.stderr.write(
        `Public artifact download interrupted; retrying (${attempt + 1}/${DOWNLOAD_ATTEMPTS}).\n`,
      );
      await setTimeout(RETRY_DELAY_MS * attempt);
    }
  }
}

async function readArtifactAttempt(
  url: URL,
  headers: Readonly<Record<string, string>>,
): Promise<PublicArtifact> {
  const response = await fetch(url, { cache: "no-store", headers });
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    throw new Error(`Public artifact download failed with HTTP ${response.status}`);
  }
  const digest = createHash("sha256");
  for await (const chunk of response.body) digest.update(chunk);
  return {
    contentEncoding: response.headers.get("content-encoding"),
    sha256: digest.digest("hex"),
  };
}

function isTransientDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && typeof error.code === "string" && TRANSIENT_CODES.has(error.code)) {
    return true;
  }
  return error.cause instanceof Error && isTransientDownloadError(error.cause);
}

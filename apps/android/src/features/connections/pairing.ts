/** V1 pairing owner, extracted without changing interaction or resource lifetime. */
import { parsePairingPayload } from "@codewide/codex-protocol/pairing";
import { humanPairingError } from "./pairingError";

export function pairingParseResult(
  raw: string,
):
  | { value: ReturnType<typeof parsePairingPayload>; parsedAt: number; error: null }
  | { value: null; parsedAt: number; error: string } {
  const parsedAt = Date.now();
  try {
    return { value: parsePairingPayload(raw, parsedAt), parsedAt, error: null };
  } catch (cause) {
    return { value: null, parsedAt, error: humanPairingError(cause) };
  }
}

export function pairingEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.port === "" ? url.hostname : `${url.hostname}:${url.port}`;
  } catch {
    return endpoint.trim() === "" ? "Secure remote host" : endpoint.trim();
  }
}

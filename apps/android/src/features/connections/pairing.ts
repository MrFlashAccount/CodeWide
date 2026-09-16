/** V1 pairing owner, extracted without changing interaction or resource lifetime. */
import { parsePairingPayload } from "@codewide/codex-protocol/pairing";
import { humanPairingError } from "./pairingError";

export function pairingParseResult(
  raw: string,
):
  | { error: null; parsedAt: number; value: ReturnType<typeof parsePairingPayload> }
  | { error: string; parsedAt: number; value: null } {
  const parsedAt = Date.now();
  try {
    return { error: null, parsedAt, value: parsePairingPayload(raw, parsedAt) };
  } catch (error) {
    return { error: humanPairingError(error), parsedAt, value: null };
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

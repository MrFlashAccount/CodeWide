// The Companion decoder admits 4096 encoded bytes after its version prefix.
// Keep the token opaque here; only its persistence/resource bound is shared.
const MAX_SOURCE_WITNESS_LENGTH = 4096 + "codewide-history-source-v1:".length;

/** Accepts a bounded opaque source checkpoint for persistence and later echo. */
export function isThreadHistorySourceWitness(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SOURCE_WITNESS_LENGTH;
}

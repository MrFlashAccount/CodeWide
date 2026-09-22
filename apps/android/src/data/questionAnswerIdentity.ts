import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** Shared content-free identity for question sending and native delivery reconciliation. */
export function questionCommandId(threadId: string, itemId: string): string {
  return `question-answer-${bytesToHex(sha256(utf8ToBytes(JSON.stringify([threadId, itemId]))))}`;
}

import type { V2U64 } from "@codewide/sync-client/v2";

export interface DecodedTerminalChunk {
  data: string;
  nextOffset: V2U64;
  offset: V2U64;
}

/** Keeps replay cursors on complete UTF-8 boundaries when wire chunks split a code point. */
export class TerminalUtf8Decoder {
  #offset: V2U64;
  #pending = new Uint8Array(0);

  constructor(offset: V2U64) {
    this.#offset = offset;
  }

  push(offset: V2U64, bytes: Uint8Array): DecodedTerminalChunk | null {
    if (offset !== addTerminalOffset(this.#offset, this.#pending.length))
      throw new Error("Terminal output cursor is discontinuous");
    const combined = new Uint8Array(this.#pending.length + bytes.length);
    combined.set(this.#pending);
    combined.set(bytes, this.#pending.length);
    const completeLength = completeUtf8PrefixLength(combined);
    if (completeLength === 0) {
      this.#pending = combined;
      return null;
    }
    const start = this.#offset;
    this.#offset = addTerminalOffset(start, completeLength);
    this.#pending = combined.slice(completeLength);
    return {
      data: new TextDecoder().decode(combined.subarray(0, completeLength)),
      nextOffset: this.#offset,
      offset: start,
    };
  }

  finish(offset: V2U64): DecodedTerminalChunk | null {
    if (this.#pending.length === 0) return null;
    if (offset !== addTerminalOffset(this.#offset, this.#pending.length))
      throw new Error("Terminal exit cursor is discontinuous");
    const start = this.#offset;
    const data = new TextDecoder().decode(this.#pending);
    this.#pending = new Uint8Array(0);
    this.#offset = offset;
    return { data, nextOffset: offset, offset: start };
  }
}

function addTerminalOffset(offset: V2U64, increment: number): V2U64 {
  let carry = increment;
  const digits = offset.split("");
  for (let index = digits.length - 1; index >= 0 && carry > 0; index -= 1) {
    const digit = Number(digits[index]);
    const sum = digit + (carry % 10);
    digits[index] = String(sum % 10);
    carry = Math.floor(carry / 10) + Math.floor(sum / 10);
  }
  while (carry > 0) {
    digits.unshift(String(carry % 10));
    carry = Math.floor(carry / 10);
  }
  return digits.join("");
}

function completeUtf8PrefixLength(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let leadIndex = bytes.length - 1;
  while (leadIndex >= 0 && isContinuation(bytes[leadIndex] ?? 0)) leadIndex -= 1;
  if (leadIndex < 0) return bytes.length;
  const lead = bytes[leadIndex] ?? 0;
  const expectedLength = utf8SequenceLength(lead);
  return bytes.length - leadIndex < expectedLength ? leadIndex : bytes.length;
}

function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function utf8SequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 1;
}

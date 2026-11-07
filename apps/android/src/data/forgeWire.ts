/**
 * Strict decoding primitives for the forge and review wire contracts.
 *
 * Every Companion forge/review result is untrusted input. Decoders throw
 * {@link ForgeWireError} with a field path; each public `parse*` entry point
 * converts that into `null`, so no partially validated value escapes.
 */
import { unknownRecord } from "./unknownRecord";

/** A wire value did not match the declared contract. The message names only the field path. */
export class ForgeWireError extends Error {
  /** Field path of the first mismatch, never the received value. */
  readonly path: string;

  constructor(path: string) {
    super(`Invalid forge wire field: ${path}`);
    this.name = "ForgeWireError";
    this.path = path;
  }
}

/** Reads one object field set; arrays and null are rejected. */
export function record(value: unknown, path: string): Record<string, unknown> {
  const result = unknownRecord(value);
  if (result === null) {
    throw new ForgeWireError(path);
  }
  return result;
}

/** Reads a string field. */
export function text(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ForgeWireError(path);
  }
  return value;
}

/** Reads a string field that must not be empty. */
export function nonEmptyText(value: unknown, path: string): string {
  const result = text(value, path);
  if (result.length === 0) {
    throw new ForgeWireError(path);
  }
  return result;
}

/** Reads a nullable string field. */
export function optionalText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

/** Reads a finite number field. */
function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ForgeWireError(path);
  }
  return value;
}

/** Reads a non-negative integer field. */
export function count(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isInteger(result) || result < 0) {
    throw new ForgeWireError(path);
  }
  return result;
}

/** Reads a nullable non-negative integer field. */
export function optionalCount(value: unknown, path: string): number | null {
  return value === null ? null : count(value, path);
}

/** Reads a boolean field. */
export function flag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ForgeWireError(path);
  }
  return value;
}

/** Reads one member of a closed literal set. */
export function oneOf<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ForgeWireError(path);
  }
  return match;
}

/** Reads an array, decoding every element with its index in the path. */
export function list<Value>(
  value: unknown,
  path: string,
  decode: (item: unknown, itemPath: string) => Value,
): Value[] {
  if (!Array.isArray(value)) {
    throw new ForgeWireError(path);
  }
  return value.map((item: unknown, index) => decode(item, `${path}[${String(index)}]`));
}

/** Reads an array of strings. */
export function textList(value: unknown, path: string): string[] {
  return list(value, path, text);
}

/** Runs one decoder at a public boundary: a contract mismatch becomes `null`. */
export function decodeOrNull<Value>(decode: () => Value): Value | null {
  try {
    return decode();
  } catch (error) {
    if (error instanceof ForgeWireError) {
      return null;
    }
    throw error;
  }
}

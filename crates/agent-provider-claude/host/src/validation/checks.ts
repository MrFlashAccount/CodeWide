/**
 * Structural shape checks for values that cross a trust boundary (RPC
 * params, the host's own state files). A check returns the typed value or
 * throws `ShapeError` naming the offending path; unknown extra fields are
 * ignored. Pure; no I/O.
 */

import { isRecord, type JsonRecord } from "../mapping/frames.js";

export type Check<Value> = (value: unknown, path: string) => Value;

/** A value does not have the expected shape. */
export class ShapeError extends Error {
  public override readonly name = "ShapeError";
}

const fail = (path: string, expected: string): never => {
  throw new ShapeError(`${path}: expected ${expected}`);
};

export const str: Check<string> = (value, path) =>
  typeof value === "string" ? value : fail(path, "string");

export const bool: Check<boolean> = (value, path) =>
  typeof value === "boolean" ? value : fail(path, "boolean");

export const int: Check<number> = (value, path) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : fail(path, "integer");

export const num: Check<number> = (value, path) =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(path, "number");

/** JSON object with any fields. */
export const record: Check<JsonRecord> = (value, path) =>
  isRecord(value) ? value : fail(path, "object");

/** Any JSON value, kept as `unknown`. */
export const anyValue: Check<unknown> = (value) => value;

/** `null` and an absent field both become `null`. */
export const nullable =
  <Value>(inner: Check<Value>): Check<Value | null> =>
  (value, path) =>
    value === null || value === undefined ? null : inner(value, path);

export const list =
  <Value>(inner: Check<Value>): Check<readonly Value[]> =>
  (value, path) =>
    Array.isArray(value)
      ? value.map((entry: unknown, index) => inner(entry, `${path}[${String(index)}]`))
      : fail(path, "array");

/** One of the given string literals. */
export const oneOf = <Literal extends string>(allowed: readonly Literal[]): Check<Literal> => {
  const accepted: ReadonlySet<unknown> = new Set<unknown>(allowed);
  const isAllowed = (value: unknown): value is Literal => accepted.has(value);
  return (value, path) => (isAllowed(value) ? value : fail(path, allowed.join(" | ")));
};

/** Typed access to the fields of one checked object. */
export interface ObjectReader {
  /** Reads one field with `check`, reporting `<path>.<name>` on failure. */
  readonly at: <Value>(name: string, check: Check<Value>) => Value;
  readonly path: string;
}

/** Checks that `value` is an object and returns a reader for its fields. */
export const objectReader = (value: unknown, path: string): ObjectReader => {
  const object = record(value, path);
  return {
    at: (name, check) => check(object[name], `${path}.${name}`),
    path,
  };
};

/** A check for a discriminated union keyed by the string field `key`. */
export const tagged =
  <Value>(
    key: string,
    variants: Readonly<Record<string, (reader: ObjectReader) => Value>>,
  ): Check<Value> =>
  (value, path) => {
    const reader = objectReader(value, path);
    const tag = reader.at(key, str);
    const variant = Object.hasOwn(variants, tag) ? variants[tag] : undefined;
    return variant === undefined
      ? fail(`${path}.${key}`, Object.keys(variants).join(" | "))
      : variant(reader);
  };

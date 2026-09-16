/**
 * Values crossing the CodeWide protocol boundary are JSON values. Clone them
 * through that same representation instead of relying on a browser global:
 * React Native exposes an internal structured-clone implementation, but does
 * not install `globalThis.structuredClone` in Hermes.
 */
export function cloneProtocolValue<T>(value: T): T {
  const serialized = JSON.stringify(value);
  // WHY: JSON.stringify returns undefined for top-level undefined, functions and symbols at runtime despite the generic library overload.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (serialized === undefined) {
    return value;
  }
  const parsed: unknown = JSON.parse(serialized);
  // WHY: this owner accepts only protocol JSON values, and a JSON round trip preserves their generic runtime shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parsed as T;
}

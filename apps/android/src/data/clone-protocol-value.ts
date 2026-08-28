/**
 * Values crossing the CodeWide protocol boundary are JSON values. Clone them
 * through that same representation instead of relying on a browser global:
 * React Native exposes an internal structured-clone implementation, but does
 * not install `globalThis.structuredClone` in Hermes.
 */
export function cloneProtocolValue<T>(value: T): T {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? value : JSON.parse(serialized) as T;
}

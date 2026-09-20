/** Browser-harness boundary: expo-pretext selects its Canvas backend before using this loader. */
export class NativeModule {}

/** Native modules are intentionally unavailable in the standalone browser experiment. */
export function requireNativeModule(): never {
  throw new Error("Native Expo modules are unavailable in the browser experiment");
}

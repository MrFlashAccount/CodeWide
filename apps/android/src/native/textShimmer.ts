import { NativeModules, Platform } from "react-native";
import { unknownRecord } from "../data/unknownRecord";

type TextShimmerBridge = {
  readonly attach: (reactTag: number, token: string) => void;
  readonly detach: (reactTag: number, token: string) => void;
};

function isTextShimmerBridge(value: unknown): value is TextShimmerBridge {
  const record = unknownRecord(value);
  return (
    record !== null && typeof record.attach === "function" && typeof record.detach === "function"
  );
}

/** Attaches a native decoration without replacing or restyling the target text. */
export function attachTextShimmer(reactTag: number, token: string): () => void {
  if (Platform.OS !== "android") {
    return () => {};
  }
  const bridge: unknown = NativeModules.CodeWideTextShimmer;
  if (!isTextShimmerBridge(bridge)) {
    return () => {};
  }
  bridge.attach(reactTag, token);
  return () => {
    bridge.detach(reactTag, token);
  };
}

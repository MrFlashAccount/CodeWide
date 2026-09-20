import type { NativeTerminalSession } from "../native/native-transport";

/** Read state for the Android-owned inventory of running V1 terminal sessions. */
export type NativeTerminalInventorySnapshot =
  | { readonly sessions: readonly []; readonly status: "idle" }
  | { readonly sessions: readonly NativeTerminalSession[]; readonly status: "loading" }
  | { readonly sessions: readonly NativeTerminalSession[]; readonly status: "ready" }
  | {
      readonly message: string;
      readonly sessions: readonly NativeTerminalSession[];
      readonly status: "error";
    };

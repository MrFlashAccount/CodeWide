import { useSyncExternalStore } from "react";

import type { TerminalController } from "../terminalController";
import type { TerminalContextSnapshot } from "../../domain/terminalSession";
import type { QualifiedThread } from "../../domain/qualifiedThread";

/** Reactive, route-independent model for a conversation Terminal context chip. */
export function useTerminalContext(
  controller: TerminalController,
  owner: QualifiedThread,
): TerminalContextSnapshot {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.contextSnapshot(owner),
    () => controller.contextSnapshot(owner),
  );
}

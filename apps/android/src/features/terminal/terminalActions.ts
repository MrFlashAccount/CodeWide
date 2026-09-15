import { Platform } from "react-native";
import {
  closeInteractiveTerminalWorkspace,
  createInteractiveTerminalTab,
  readInteractiveTerminalWorkspace,
} from "../../data/interactive-terminal-store";
import { useEvent } from "../../react/useEvent";

/** Explicit tab creation and opening retain the existing native workspace authority. */
export function useTerminalActions(
  draftConnectionId: string | null,
  draftThreadId: string | null,
  cwd: string | null | undefined,
  presentTerminal: () => void,
) {
  const openTerminal = useEvent(() => {
    if (draftConnectionId === null || draftThreadId === null) return;
    if (
      Platform.OS === "android" &&
      readInteractiveTerminalWorkspace(draftConnectionId, draftThreadId).tabs.length === 0
    ) {
      createInteractiveTerminalTab({
        connectionId: draftConnectionId,
        threadId: draftThreadId,
        cwd: cwd ?? null,
      });
    }
    presentTerminal();
  });
  const createAndOpenTerminal = useEvent(() => {
    if (draftConnectionId === null || draftThreadId === null) return;
    if (Platform.OS === "android") {
      createInteractiveTerminalTab({
        connectionId: draftConnectionId,
        threadId: draftThreadId,
        cwd: cwd ?? null,
      });
    }
    presentTerminal();
  });
  return { openTerminal, createAndOpenTerminal };
}

/** Delete acknowledgement closes only the workspace captured by that activation. */
export function useTerminalDeletion(
  onDelete: (() => Promise<void>) | undefined,
  draftConnectionId: string | null,
  draftThreadId: string | null,
) {
  const deleteThread = useEvent(async () => {
    if (onDelete === undefined) return;
    await onDelete();
    if (draftConnectionId !== null && draftThreadId !== null)
      closeInteractiveTerminalWorkspace(draftConnectionId, draftThreadId);
  });
  return onDelete === undefined ? undefined : deleteThread;
}

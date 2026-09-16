import { useState } from "react";
import type { BackgroundTerminalValue } from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";

/** Background-process termination stays pending through the captured list refresh. */
export function useBackgroundTerminalActions(
  onList: (() => Promise<BackgroundTerminalValue[]>) | undefined,
  onTerminate: ((processId: string) => Promise<boolean>) | undefined,
) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useEvent(async () => {
    if (onList !== undefined) {
      await onList();
    }
  });
  const terminate = useEvent(async (processId: string) => {
    if (onTerminate === undefined) {
      return;
    }
    setBusyId(processId);
    setError(null);
    try {
      if (await onTerminate(processId)) {
        if (onList !== undefined) {
          await onList();
        }
      } else {
        setError("Process was already gone");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not terminate process");
    }
    setBusyId(null);
  });
  return { busyId, error, reload, terminate };
}

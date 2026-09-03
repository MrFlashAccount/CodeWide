import type { V2U64 } from "@codewide/sync-client/v2";
import { useEffect, useRef } from "react";

import { useEvent } from "../../../../react/useEvent";
import type { TerminalController } from "../../../application/terminalController";
import type { QualifiedThread } from "../../../domain/qualifiedThread";

interface InitialTerminalInput {
  controller: TerminalController;
  cwd: string | null;
  enabled: boolean;
  generation: V2U64 | null;
  onError(message: string): void;
  owner: QualifiedThread;
}

/** Binds initial route activation to one runtime-owned tab without owning its lifetime. */
export function useInitialTerminal(input: InitialTerminalInput): void {
  const attemptedOwner = useRef<string | null>(null);
  const ownerKey = `${input.owner.savedServerId}\u0000${input.owner.threadId}`;
  const open = useEvent((): void => {
    if (input.generation === null) return;
    void input.controller
      .ensureOpen(input.owner, input.generation, input.cwd)
      .catch((cause: unknown) => {
        input.onError(message(cause));
      });
  });
  useEffect(() => {
    if (!input.enabled || input.generation === null || attemptedOwner.current === ownerKey) return;
    attemptedOwner.current = ownerKey;
    open();
  }, [input.enabled, input.generation, open, ownerKey]);
}

function message(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "Could not open terminal";
}

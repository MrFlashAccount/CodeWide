import { useEvent } from "../../react/useEvent";
import type { AppFullscreenOverlayController } from "../../ui/AppFullscreenOverlay";
import { TerminalWorkspace } from "./TerminalWorkspace";

/** Hiding the host retains native terminal tabs even when the opening chat unmounts. */
export function useTerminalFeature(
  draftConnectionId: string | null,
  draftThreadId: string | null,
  cwd: string | null | undefined,
  fullscreenOverlay: Pick<AppFullscreenOverlayController, "present">,
) {
  const presentTerminal = useEvent(() => {
    if (draftConnectionId === null || draftThreadId === null) return;
    fullscreenOverlay.present(
      ({ close }) => (
        <TerminalWorkspace
          connectionId={draftConnectionId}
          threadId={draftThreadId}
          cwd={cwd ?? null}
          onMinimize={close}
        />
      ),
      { dismissOnScopeUnmount: false },
    );
  });
  return presentTerminal;
}

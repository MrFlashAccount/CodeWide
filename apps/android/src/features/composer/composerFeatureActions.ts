import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import { useEvent } from "../../react/useEvent";
import type { ComposerMenuPage, ComposerAccessoryAction } from "./composerTypes";

export function useComposerFeatureActions(
  pickComposerAttachment: () => Promise<void>,
  openDrawing: () => void,
  createAndOpenTerminal: () => void,
  openControls: (page: ComposerMenuPage) => void,
  onGetGoal: (() => Promise<ThreadGoal | null>) | undefined,
) {
  const openComposerFeature = useEvent((action: ComposerAccessoryAction) => {
    if (action === "files") {
      void pickComposerAttachment();
      return;
    }
    if (action === "drawing") {
      openDrawing();
      return;
    }
    if (action === "terminal") {
      createAndOpenTerminal();
      return;
    }
    if (action === "ports") {
      openControls("ports");
      return;
    }
    openControls(action);
    if (action === "goal") void onGetGoal?.();
  });
  return { openComposerFeature };
}

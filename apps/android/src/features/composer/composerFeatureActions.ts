import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import type { ComposerMenuPage, ComposerAccessoryAction } from "./composerTypes";

export function useComposerFeatureActions(
  pickComposerAttachment: () => Promise<void>,
  openDrawing: () => void,
  openControls: (page: ComposerMenuPage) => void,
  openGoalAttachment: () => void,
) {
  const dialog = useAppDialog();
  const run = useEvent((operation: () => Promise<unknown>, fallback: string): void => {
    operation().catch((error: unknown) => {
      dialog.alert(fallback, error instanceof Error ? error.message : fallback);
    });
  });
  const openComposerFeature = useEvent((action: ComposerAccessoryAction) => {
    if (action === "files") {
      run(pickComposerAttachment, "Could not attach file");
      return;
    }
    if (action === "drawing") {
      openDrawing();
      return;
    }
    if (action === "goal") {
      openGoalAttachment();
      return;
    }
    openControls(action);
  });
  return { openComposerFeature };
}

import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import type { ComposerMenuPage, ComposerAccessoryAction } from "./composerTypes";

/** Composer menu destinations, each owned by the feature that performs it. */
export type ComposerFeatureDestinations = {
  readonly createAndOpenTerminal: () => void;
  readonly editGoalInComposer: () => void;
  readonly focusComposer: () => void;
  readonly openControls: (page: ComposerMenuPage) => void;
  readonly openDrawing: () => void;
  readonly openGoalAttachment: () => void;
  readonly pickComposerAttachment: () => Promise<void>;
  readonly pickComposerPhotos: () => Promise<void>;
  readonly takeComposerPhoto: () => Promise<void>;
};

export function useComposerFeatureActions({
  createAndOpenTerminal,
  editGoalInComposer,
  focusComposer,
  openControls,
  openDrawing,
  openGoalAttachment,
  pickComposerAttachment,
  pickComposerPhotos,
  takeComposerPhoto,
}: ComposerFeatureDestinations) {
  const dialog = useAppDialog();
  const run = useEvent((operation: () => Promise<unknown>, fallback: string): void => {
    operation().catch((error: unknown) => {
      dialog.alert(fallback, error instanceof Error ? error.message : fallback);
    });
  });
  const openComposerFeature = useEvent((action: ComposerAccessoryAction) => {
    if (action === "camera") {
      run(takeComposerPhoto, "Could not take photo");
      return;
    }
    if (action === "photos") {
      run(pickComposerPhotos, "Could not add photo");
      return;
    }
    if (action === "files") {
      run(pickComposerAttachment, "Could not attach file");
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
    if (action === "goal") {
      openGoalAttachment();
      requestAnimationFrame(focusComposer);
      return;
    }
    openControls(action);
  });
  const openGoalDetails = useEvent(() => {
    editGoalInComposer();
    requestAnimationFrame(focusComposer);
  });
  return { openComposerFeature, openGoalDetails };
}

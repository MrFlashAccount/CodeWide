import { readFileSync } from "node:fs";

export const composerMarkdownInput = readFileSync(
  new URL("../../src/features/composer/input/ComposerMarkdownInput.native.tsx", import.meta.url),
  "utf8",
);
export const ownerAttachmentAdmission = readFileSync(
  new URL("../../src/features/composer/attachments/attachmentAdmission.ts", import.meta.url),
  "utf8",
);
export const ownerDraft = readFileSync(
  new URL("../../src/features/composer/draft.ts", import.meta.url),
  "utf8",
);
export const ownerComposerMicrophone = readFileSync(
  new URL("../../src/features/composer/ComposerMicrophone.tsx", import.meta.url),
  "utf8",
);
export const ownerComposerSubmitAction = readFileSync(
  new URL("../../src/features/composer/ComposerSubmitAction.tsx", import.meta.url),
  "utf8",
);
export const ownerComposerControlChips = readFileSync(
  new URL("../../src/features/composer/settings/ComposerControlChips.tsx", import.meta.url),
  "utf8",
);
export const ownerComposerControlOptions = readFileSync(
  new URL("../../src/features/composer/settings/ComposerControlOptions.tsx", import.meta.url),
  "utf8",
);
export const ownerSettings = readFileSync(
  new URL("../../src/features/composer/settings.ts", import.meta.url),
  "utf8",
);
export const ownerVoiceCaptureStatus = readFileSync(
  new URL("../../src/features/composer/voice/VoiceCaptureStatus.tsx", import.meta.url),
  "utf8",
);
export const ownerComposerFeature = readFileSync(
  new URL("../../src/features/composer/ComposerFeature.tsx", import.meta.url),
  "utf8",
);
export const ownerComposerAccessoryTray = readFileSync(
  new URL("../../src/features/composer/ComposerAccessoryTray.tsx", import.meta.url),
  "utf8",
);
export const ownerComposerFeatureStyles = readFileSync(
  new URL("../../src/features/composer/ComposerFeature.styles.ts", import.meta.url),
  "utf8",
);
export const ownerComposerEditorStyles = readFileSync(
  new URL("../../src/features/composer/ComposerEditor.styles.ts", import.meta.url),
  "utf8",
);
export const ownerSubmission = readFileSync(
  new URL("../../src/features/composer/submission.ts", import.meta.url),
  "utf8",
);
export const ownerComposerMenu = readFileSync(
  new URL("../../src/features/composer/ComposerMenu.tsx", import.meta.url),
  "utf8",
);
export const composerMenuStyles = readFileSync(
  new URL("../../src/features/composer/ComposerMenu.styles.ts", import.meta.url),
  "utf8",
);
export const ownerNativeEditorStyles = readFileSync(
  new URL("../../src/features/composer/input/nativeEditorStyles.ts", import.meta.url),
  "utf8",
);
export const composerControlStyles = readFileSync(
  new URL("../../src/features/composer/settings/ComposerControlChips.styles.ts", import.meta.url),
  "utf8",
);
export const composerAdapter = readFileSync(
  new URL("../../src/features/composer/workspaceAdapter.ts", import.meta.url),
  "utf8",
);

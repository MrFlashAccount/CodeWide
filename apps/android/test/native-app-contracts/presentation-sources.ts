import { readFileSync } from "node:fs";

export const appErrorBoundary = readFileSync(
  new URL("../../src/ui/AppErrorBoundary.tsx", import.meta.url),
  "utf8",
);
export const globalErrorStore = readFileSync(
  new URL("../../src/ui/global-error-store.ts", import.meta.url),
  "utf8",
);
export const conversationPanelUnderlay = readFileSync(
  new URL("../../src/ui/ConversationPanelUnderlay.tsx", import.meta.url),
  "utf8",
);
export const conversationChromeLayout = readFileSync(
  new URL("../../src/ui/conversation-chrome-layout.ts", import.meta.url),
  "utf8",
);
export const heroUIRoot = readFileSync(
  new URL("../../src/ui/HeroUIRoot.native.tsx", import.meta.url),
  "utf8",
);
export const waveText = readFileSync(new URL("../../src/ui/WaveText.tsx", import.meta.url), "utf8");
export const appSheet = readFileSync(
  new URL("../../src/ui/AppSheet.android.tsx", import.meta.url),
  "utf8",
);
export const appFullscreenModal = readFileSync(
  new URL("../../src/ui/AppFullscreenModal.native.tsx", import.meta.url),
  "utf8",
);
export const turnControlMenus = readFileSync(
  new URL("../../src/ui/TurnControlMenus.native.tsx", import.meta.url),
  "utf8",
);
export const actionMenu = readFileSync(
  new URL("../../src/ui/ActionMenu.native.tsx", import.meta.url),
  "utf8",
);
export const swipeDiscardAction = readFileSync(
  new URL("../../src/ui/SwipeDiscardAction.tsx", import.meta.url),
  "utf8",
);
export const messageActionMenu = readFileSync(
  new URL("../../src/ui/MessageActionMenu.native.tsx", import.meta.url),
  "utf8",
);
export const heroUiRoot = readFileSync(
  new URL("../../src/ui/HeroUIRoot.native.tsx", import.meta.url),
  "utf8",
);
export const appDialog = readFileSync(
  new URL("../../src/ui/AppDialog.tsx", import.meta.url),
  "utf8",
);
export const appDialogSurface = readFileSync(
  new URL("../../src/ui/AppDialogSurface.native.tsx", import.meta.url),
  "utf8",
);
export const voiceAura = readFileSync(
  new URL("../../src/ui/VoiceAura.native.tsx", import.meta.url),
  "utf8",
);
export const threadTitle = readFileSync(
  new URL("../../src/ui/ThreadTitle.tsx", import.meta.url),
  "utf8",
);
export const resourceContextChip = readFileSync(
  new URL("../../src/ui/ResourceContextChip.tsx", import.meta.url),
  "utf8",
);
export const resourceContextChipStyles = readFileSync(
  new URL("../../src/ui/ResourceContextChip.styles.ts", import.meta.url),
  "utf8",
);
export const calmSpinner = readFileSync(
  new URL("../../src/ui/CalmSpinner.tsx", import.meta.url),
  "utf8",
);

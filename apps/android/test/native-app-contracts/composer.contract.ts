import { expect, it } from "vitest";
import { sourceHasJsxElement, sourceObjectDeclaration } from "../source-contract";
import {
  ownerSettings,
  ownerComposerMicrophone,
  ownerComposerSubmitAction,
  ownerComposerMenu,
  ownerComposerControlChips,
  ownerComposerFeature,
  composerMenuStyles,
  ownerComposerControlOptions,
  ownerVoiceCaptureStatus,
  composerAdapter,
  ownerNativeEditorStyles,
  ownerComposerAccessoryTray,
  composerControlStyles,
  ownerComposerFeatureStyles,
  ownerComposerEditorStyles,
} from "./composer-sources";

it("preserves composer integration contracts", () => {
  expect(ownerSettings).not.toContain("setMenuVisible");
  expect(ownerSettings).toContain("requestControls()");
  expect(ownerComposerMicrophone).toContain('"Stop voice input and insert transcript"');
  expect(ownerComposerSubmitAction).toContain('"Finish voice input and send transcript"');
  expect(
    sourceHasJsxElement(ownerComposerMenu, "AppSheet", [
      "isOpen={visible}",
      "onOpenChange={(open) =>",
      "if (!open)",
      "onClose();",
    ]),
  ).toBe(true);
  expect(ownerComposerControlChips).toContain("accessibilityLabel={`Model and thinking:");
  expect(ownerComposerControlChips).toContain("<ModelThinkingMenu");
  expect(ownerComposerControlChips).toContain("<PermissionsMenu");
  expect(ownerComposerControlChips).toMatch(
    /onFallbackPress=\{\(\) => \{\s*onFallback\("model"\);\s*\}\}/u,
  );
  expect(ownerComposerControlChips).toMatch(
    /onFallbackPress=\{\(\) => \{\s*onFallback\("permissions"\);\s*\}\}/u,
  );
  expect(ownerComposerFeature).toContain("<ActionMenu");
  const menuTitleRow = sourceObjectDeclaration(composerMenuStyles, "menuTitleRow");
  expect(menuTitleRow).toContain("marginBottom: spacing.xs");
  expect(menuTitleRow).toContain("minHeight: touchTarget");
  expect(
    sourceHasJsxElement(ownerComposerControlOptions, "AppSheetScrollView", [
      "contentContainerStyle={styles.menuScrollContent}",
      'keyboardShouldPersistTaps="handled"',
      "style={styles.menuScroll}",
    ]),
  ).toBe(true);
  expect(ownerComposerControlOptions).toMatch(
    /<Text style=\{styles\.controlSectionLabel\}>\s*Thinking\s*<\/Text>/u,
  );
  expect(ownerSettings).toMatch(/onUpdateSettings\(\{(?=[^}]*effort)(?=[^}]*model)[^}]*\}\)/u);
  expect(ownerComposerControlChips).toContain(
    "executionPermissionsLabel(serverExecution, pending)",
  );
  expect(ownerComposerControlOptions).toMatch(
    /const reasoningEfforts\s*=\s*model === undefined\s*\? \[\]/u,
  );
  const menuScroll = sourceObjectDeclaration(composerMenuStyles, "menuScroll");
  expect(menuScroll).toContain("flex: 1");
  expect(menuScroll).toContain("minHeight: 0");
  expect(ownerVoiceCaptureStatus).toContain("function VoiceCaptureStatus({");
  expect(ownerVoiceCaptureStatus).toContain(
    'useVoiceInputLevel(controller, phase === "recording" ? scope : null)',
  );
  expect(ownerComposerMicrophone).toMatch(
    /accessibilityLabel=\{\s*voiceRetryAvailable\s*\?\s*"Retry voice transcription"/,
  );
  expect(composerAdapter).toContain("getOrCreateThreadUiState");
  expect(ownerComposerFeature).toContain('testID="composer-dock"');
  expect(ownerComposerSubmitAction).toContain("disabled={sendDisabled}");
  expect(ownerNativeEditorStyles).toContain('flexBasis: "auto"');
  expect(ownerNativeEditorStyles).toContain("The native editor owns intrinsic content height");
  expect(ownerComposerSubmitAction).toContain("<ComposerDeliveryMenu");
  expect(ownerComposerAccessoryTray).toContain('testID="composer-accessory-tray"');
  expect(ownerComposerAccessoryTray).toContain(
    'const useAnchoredComposerMenu = Platform.OS === "android";',
  );
  expect(ownerComposerFeature).toContain("if (open)");
  expect(ownerComposerFeature).toContain("props.dismissComposerKeyboardForOverlay();");
  expect(ownerComposerAccessoryTray).not.toContain('icon: "terminal-outline"');
  expect(ownerComposerAccessoryTray).not.toContain('id: "ports"');
  const composerContextChip = sourceObjectDeclaration(composerControlStyles, "composerContextChip");
  expect(composerContextChip).toContain("flexGrow: 0");
  expect(composerContextChip).toContain("flexShrink: 0");
  expect(composerControlStyles).not.toContain("composerContextChip: { maxWidth:");
  expect(
    sourceHasJsxElement(ownerComposerFeature, "View", [
      "style={styles.composerInputShell}",
      'testID="composer-input-shell"',
    ]),
  ).toBe(true);
  const composerInputShell = sourceObjectDeclaration(
    ownerComposerFeatureStyles,
    "composerInputShell",
  );
  expect(composerInputShell).toContain("flex: 1");
  expect(composerInputShell).toContain("flexBasis: 0");
  expect(composerInputShell).toContain("flexShrink: 1");
  expect(composerInputShell).toContain("minWidth: 0");
  expect(composerInputShell).toContain("width: 0");
  const composerInput = sourceObjectDeclaration(ownerComposerEditorStyles, "composerInput");
  expect(composerInput).toContain("maxHeight: COMPOSER_MAX_HEIGHT");
  expect(composerInput).toContain("minHeight: COMPOSER_MIN_HEIGHT");
  expect(ownerSettings).toContain("an already loaded sheet\n    // never refetches its model");
  expect(ownerSettings).toContain(
    'if (initialPage !== "ports" && (current === null || current.status === "error"))',
  );
  expect(ownerSettings).toContain("requestControls();");
});

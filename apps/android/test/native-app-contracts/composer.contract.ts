import { expect, it } from "vitest";
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
  expect(ownerSettings).toContain("setMenuVisible(false);");
  expect(ownerComposerMicrophone).toContain('"Stop voice input and insert transcript"');
  expect(ownerComposerSubmitAction).toContain('"Finish voice input and send transcript"');
  expect(ownerComposerMenu).toMatch(
    /<AppSheet\s+isOpen=\{visible\}\s+onOpenChange=\{\(open\) => \{\s*if \(!open\) onClose\(\);\s*\}\}/u,
  );
  expect(ownerComposerControlChips).toContain("accessibilityLabel={`Model and thinking:");
  expect(ownerComposerControlChips).toContain("<ModelThinkingMenu");
  expect(ownerComposerControlChips).toContain("<PermissionsMenu");
  expect(ownerComposerControlChips).toContain('onFallbackPress={() => onFallback("model")}');
  expect(ownerComposerControlChips).toContain('onFallbackPress={() => onFallback("permissions")}');
  expect(ownerComposerFeature).toContain("<ActionMenu");
  expect(composerMenuStyles).toMatch(
    /menuTitleRow: \{[^}]*minHeight: touchTarget[^}]*marginBottom: spacing\.xs/u,
  );
  expect(ownerComposerControlOptions).toMatch(
    /<AppSheetScrollView\s+[^>]*style=\{styles\.menuScroll\}[^>]*contentContainerStyle=\{styles\.menuScrollContent\}[^>]*keyboardShouldPersistTaps="handled"[^>]*>/u,
  );
  expect(ownerComposerControlOptions).toMatch(
    /<Text style=\{styles\.controlSectionLabel\}>\s*Thinking\s*<\/Text>/u,
  );
  expect(ownerSettings).toContain("onUpdateSettings({ model, effort })");
  expect(ownerComposerControlChips).toContain(
    "executionPermissionsLabel(serverExecution, pending)",
  );
  expect(ownerComposerControlOptions).toMatch(
    /const reasoningEfforts\s*=\s*model === undefined\s*\? \[\]/u,
  );
  expect(composerMenuStyles).toMatch(/menuScroll: \{[^}]*flex: 1[^}]*minHeight: 0[^}]*\}/u);
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
  expect(ownerComposerFeature).toContain("if (open) props.dismissComposerKeyboardForOverlay();");
  expect(ownerComposerAccessoryTray).toContain('icon: "terminal-outline"');
  expect(composerControlStyles).toMatch(/composerContextChip: \{\s*flexGrow: 0,\s*flexShrink: 0/);
  expect(composerControlStyles).not.toContain("composerContextChip: { maxWidth:");
  expect(ownerComposerFeature).toContain(
    '<View testID="composer-input-shell" style={styles.composerInputShell}>',
  );
  expect(ownerComposerFeatureStyles).toMatch(
    /composerInputShell: \{\s*flex: 1,\s*flexBasis: 0,\s*flexShrink: 1,\s*width: 0,\s*minWidth: 0/,
  );
  expect(ownerComposerEditorStyles).toMatch(
    /composerInput: \{\s*minHeight: COMPOSER_MIN_HEIGHT,\s*maxHeight: COMPOSER_MAX_HEIGHT/,
  );
  expect(ownerSettings).toContain("an already loaded sheet\n    // never refetches its model");
  expect(ownerSettings).toContain(
    'if (current === null || current.status === "error") requestControls();',
  );
});

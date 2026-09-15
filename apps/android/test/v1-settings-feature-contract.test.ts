import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source contracts live beside each real feature owner; no synthetic monolith is assembled.
describe("M1 feature integration contracts", () => {
  it("connections/PairingSubmission.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/connections/PairingSubmission.tsx", import.meta.url), "utf8");
    expect(source).toContain("disabled={saving || !localReady}");
    expect(source).toContain("accessibilityLabel=\"Retry local startup\"");
  });
  it("settings/SettingsFeature.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/settings/SettingsFeature.tsx", import.meta.url), "utf8");
    expect(source).toContain('import Constants from "expo-constants"');
    expect(source).toContain(
      "<SettingsVersion version={Constants.expoConfig?.version ?? \"unknown\"} />",
    );
    expect(source).toContain("testID=\"ui-generation-setting\"");
    expect(source).toContain("<UiGenerationControl current={uiGeneration.generation} />");
  });
  it("connections/ConnectionSheet.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/connections/ConnectionSheet.tsx", import.meta.url), "utf8");
    expect(source).toContain('snapPoints: ["55%", "90%"]');
  });
  it("accounts/AccountLoginSheet.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/accounts/AccountLoginSheet.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("dialog.alert(");
    expect(source).toContain("<AppSheet");
    expect(source).toContain("One-time code");
    expect(source).toContain("{codeCopied ? \"Copied\" : \"Copy\"}");
    expect(source).toMatch(
      /enableDynamicSizing: true,\s*enableOverDrag: false/u,
    );
    expect(source).toContain("dismissLabel: \"Close Codex account sign-in\"");
  });
  it("accounts/AccountPoolFeature.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/accounts/AccountPoolFeature.tsx", import.meta.url), "utf8");
    expect(source).toContain("pendingAccountLogin !== null && (");
    expect(source).toContain("Manual selection · automatic fallback on limit");
  });
  it("accounts/AccountProfileRow.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/accounts/AccountProfileRow.tsx", import.meta.url), "utf8");
    expect(source).toContain("id: \"activate\"");
    expect(source).toContain(
      "label: profile.active ? \"Active account\" : \"Switch to account\"",
    );
    expect(source).toContain("await onActivate(connectionId, profile.id)");
  });
  it("connections/connectionPresentation.ts retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/connections/connectionPresentation.ts", import.meta.url), "utf8");
    expect(source).toContain("activity === \"connecting\" ? colors.textDim : colors.amber");
  });
  it("connections/ConnectionFeature.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/connections/ConnectionFeature.tsx", import.meta.url), "utf8");
    expect(source).toContain(
      "<ConnectionActivityIndicator status={connection.state} size={iconSize.indicator} />",
    );
    expect(source).toContain("connectionStateLabel(connection.state, connection.enabled)");
    expect(source).toContain("title: connection.displayName");
  });
  it("connections/connectionActions.ts retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/connections/connectionActions.ts", import.meta.url), "utf8");
    expect(source).toContain("isProfileOnlyConnectionUpdate(input, current)");
    expect(source).toContain(
      "actions.updateConnectionProfile(\n          connectionId,\n          profile.displayName,\n          profile.emoji,\n        )",
    );
  });
  it("connections/ConnectionRowEditor.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/connections/ConnectionRowEditor.tsx", import.meta.url), "utf8");
    expect(source).toMatch(
      /<AppListRow\s+title="Connection"\s+description=\{connection\.endpoint\}/,
    );
    expect(source).toMatch(
      /<Ionicons\s+accessibilityLabel="Secure connection"\s+name="lock-closed"\s+size=\{iconSize\.indicator\}\s+color=\{colors\.green\}\s*\/>/,
    );
    expect(source).toMatch(/descriptionLeading=\{\s*secureLive\s*\?/);
  });
  it("connections/ConnectionStatus.tsx retains its migrated UI contract", () => {
    const source = readFileSync(new URL("../src/features/connections/ConnectionStatus.tsx", import.meta.url), "utf8");
    expect(source).toContain("connectionDiagnosticSummary(connection.lastError)");
    expect(source).toContain("Error details");
  });
});

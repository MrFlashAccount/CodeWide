import { expect, it } from "vitest";
import { migratedThreadResourceContextChips, migratedChangesFeature } from "./changes-sources";
import { threadRow } from "./threadList-sources";

it("preserves changes integration contracts", () => {
  for (const owner of [migratedThreadResourceContextChips, threadRow])
    expect(owner.match(/trigger="long-press"/g)).toHaveLength(1);
  expect(migratedThreadResourceContextChips).toContain(
    "const changesInitialLoading = changesPending && !changesReady;",
  );
  expect(migratedThreadResourceContextChips).toContain(
    "const attachmentsInitialLoading = attachmentsPending && !attachmentsReady;",
  );
  expect(migratedThreadResourceContextChips).toContain(
    "const changesUnavailable = changesError !== null && !changesReady;",
  );
  expect(migratedThreadResourceContextChips).toContain(
    "const attachmentsUnavailable = attachmentsError !== null && !attachmentsReady;",
  );
  expect(migratedThreadResourceContextChips).toContain("{!changesUnavailable && (");
  expect(migratedThreadResourceContextChips).toContain("{!attachmentsUnavailable && (");
  expect(migratedThreadResourceContextChips).toMatch(
    /<ComposerContextCount\s+label="Changes"\s+value=\{changeCount\}\s+testID="composer-changes-label"\s*\/>/,
  );
  expect(migratedThreadResourceContextChips).toMatch(
    /<ComposerContextCount\s+label="Attachments"\s+value=\{attachmentCount\}\s+testID="composer-attachments-label"\s*\/>/,
  );
  expect(migratedChangesFeature).toMatch(
    /onInitialLoad: \(\) =>\s*onLoadThreadResources\(changesPreferences\.scope \?\? undefined, "changes"\)/,
  );
});

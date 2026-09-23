import { expect, it } from "vitest";
import { sourceHasJsxElement } from "../source-contract";
import { migratedThreadResourceContextChips, migratedChangesFeature } from "./changes-sources";

it("preserves changes integration contracts", () => {
  // Thread-row long press is exercised through the actual button in v1-thread-row-menu.render.
  expect(migratedThreadResourceContextChips.match(/trigger="long-press"/g)).toHaveLength(1);
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
  expect(
    sourceHasJsxElement(migratedThreadResourceContextChips, "ComposerContextCount", [
      "label={scopeTitle}",
      'testID="composer-changes-label"',
      "value={changeCount}",
    ]),
  ).toBe(true);
  expect(
    sourceHasJsxElement(migratedThreadResourceContextChips, "ComposerContextCount", [
      'label="Attachments"',
      'testID="composer-attachments-label"',
      "value={attachmentCount}",
    ]),
  ).toBe(true);
  expect(migratedChangesFeature).toMatch(
    /onInitialLoad: async \(\) =>\s*loadResources\(scope, "changes"\)/,
  );
});

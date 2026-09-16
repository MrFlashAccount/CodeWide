import { expect, it } from "vitest";
import { sourceHasJsxElement } from "../source-contract";
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
  expect(
    sourceHasJsxElement(migratedThreadResourceContextChips, "ComposerContextCount", [
      'label="Changes"',
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

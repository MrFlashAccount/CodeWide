import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("gives the attachment sheet fixed cells instead of eagerly mounting every resource", () => {
  const sheet = readFileSync(new URL("../src/features/attachments/AttachmentsFeature.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/features/attachments/AttachmentsFeature.styles.ts", import.meta.url), "utf8");
  // Fixed height is the explicit performance contract shared with the row.
  expect(sheet).toContain("<LegendList");
  expect(sheet).toContain("data={attachments}");
  expect(sheet).toContain("getFixedItemSize={() => listRowHeight.double}");
  // One sheet-integrated scroll surface owns gestures; LegendList only
  // virtualizes its contents, rather than sitting inside another scroll view.
  expect(sheet).toContain("renderScrollComponent={AppSheetScrollView}");
  expect(sheet).not.toContain("attachments.map(");
  expect(sheet).not.toContain("estimatedItemSize");
  expect(styles).toContain("threadAttachmentCell: { height: listRowHeight.double }");
  const settings = readFileSync(new URL("../src/features/settings/SettingsFeature.tsx", import.meta.url), "utf8");
  expect(settings).toContain("fixedHeight={listRowHeight.double}");
});

it("limits the Compose-only cell experiment to attachment resources", () => {
  const row = readFileSync(new URL("../src/features/attachments/ThreadAttachmentResourceRow.tsx", import.meta.url), "utf8");
  expect(row).toContain("<AttachmentListRow");
  expect(row).not.toContain("<AppListRow");
  expect(row.match(/<AttachmentListRow\b/gu)).toHaveLength(1);
  const implementation = readFileSync(
    new URL("../src/ui/AttachmentListRow.android.tsx", import.meta.url),
    "utf8",
  );
  // Boundary contract: no embedded RN accessories inside the Compose cell.
  expect(implementation).not.toContain("RNHostView");
  expect(implementation).not.toContain("@expo/vector-icons");
  expect(implementation.match(/<Host\b/gu)).toHaveLength(1);
  expect(implementation).toContain("matchContents={false}");
  expect(implementation).not.toMatch(/<AppListRow\s/u);
});

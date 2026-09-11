import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("gives the attachment sheet fixed cells instead of eagerly mounting every resource", () => {
  const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
  const sheet = screen.slice(
    screen.indexOf("function ThreadResourcesSheet("),
    screen.indexOf("function ThreadAttachmentResourceRow("),
  );
  // Fixed height is the explicit performance contract shared with the row.
  expect(sheet).toContain("<LegendList");
  expect(sheet).toContain("data={attachments}");
  expect(sheet).toContain("getFixedItemSize={() => listRowHeight.double}");
  // One sheet-integrated scroll surface owns gestures; LegendList only
  // virtualizes its contents, rather than sitting inside another scroll view.
  expect(sheet).toContain("renderScrollComponent={AppSheetScrollView}");
  expect(sheet).not.toContain("attachments.map(");
  expect(sheet).not.toContain("estimatedItemSize");
  expect(screen).toContain("threadAttachmentCell: { height: listRowHeight.double }");
  expect(screen).toContain("fixedHeight={listRowHeight.double}");
});

it("limits the Compose-only cell experiment to attachment resources", () => {
  const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
  const row = screen.slice(
    screen.indexOf("function ThreadAttachmentResourceRow("),
    screen.indexOf("function ThreadHeaderMenu("),
  );
  expect(row).toContain("<AttachmentListRow");
  expect(row).not.toContain("<AppListRow");
  expect(screen.match(/<AttachmentListRow\b/gu)).toHaveLength(1);
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

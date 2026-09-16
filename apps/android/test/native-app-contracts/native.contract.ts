import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { appPackage, rootPackage, quickdrawPatch } from "./native-sources";
import { drawingWorkspace, ownerDrawingFeature } from "./drawing-sources";

it("opens image annotations in QuickDraw and keeps the source image immutable", () => {
  expect(appPackage.dependencies["@quickdrawjs/react-native"]).toBe("0.2.0");
  expect(rootPackage.pnpm?.patchedDependencies?.["@quickdrawjs/react-native@0.2.0"]).toBe(
    "patches/@quickdrawjs__react-native@0.2.0.patch",
  );
  expect(quickdrawPatch).toContain("installLockedShapeSupport");
  expect(quickdrawPatch).toContain("record.props?.locked === true");
  expect(drawingWorkspace).toContain('boardRef.current?.setTool("draw")');
  expect(drawingWorkspace).toMatch(
    /\{(?=[^}]*background: false)(?=[^}]*margin: 0)(?=[^}]*scale: 1)[^}]*\}/u,
  );
  expect(drawingWorkspace).not.toContain("useSafeAreaInsets");
  expect(drawingWorkspace).toContain("<View style={styles.header}>");
  expect(drawingWorkspace).toContain("<View style={styles.board}>");
  expect(ownerDrawingFeature).toContain("loadQuickdrawImageSnapshot(item.source)");
  expect(ownerDrawingFeature).toContain('mode: editor?.mode ?? "image-annotation"');
  const drawingCommit = readFileSync(
    new URL("../../src/features/drawing/drawingAttachment.ts", import.meta.url),
    "utf8",
  );
  expect(drawingCommit).toContain("return stageAttachment(selected, replacement");
  expect(drawingCommit).not.toContain("await uploadSelectedAttachment");
});

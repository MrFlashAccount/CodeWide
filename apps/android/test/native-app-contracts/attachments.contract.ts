import { expect, it } from "vitest";
import { sourceObjectDeclaration } from "../source-contract";
import {
  migratedAttachmentsFeatureStyles,
  migratedAttachmentDocumentPreview,
  migratedAttachmentVisibility,
  migratedAttachmentPreview,
} from "./attachments-sources";

it("preserves attachments integration contracts", () => {
  const sheetHeaderIconSlot = sourceObjectDeclaration(
    migratedAttachmentsFeatureStyles,
    "sheetHeaderIconSlot",
  );
  expect(sheetHeaderIconSlot).toContain("flexShrink: 0");
  expect(sheetHeaderIconSlot).toContain("height: controlSize.compact");
  expect(sheetHeaderIconSlot).toContain("width: controlSize.compact");
  expect(migratedAttachmentDocumentPreview).toContain(
    "language={nativeCodeLanguageForPath(document.request.path)}",
  );
  expect(migratedAttachmentVisibility).toContain('loadResources?.(undefined, "attachments")');
  expect(migratedAttachmentPreview).toContain("useThreadResources(");
});

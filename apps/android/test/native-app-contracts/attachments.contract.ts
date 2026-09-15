import { expect, it } from "vitest";
import {
  migratedAttachmentsFeatureStyles,
  migratedAttachmentDocumentPreview,
  migratedAttachmentVisibility,
  migratedAttachmentPreview,
} from "./attachments-sources";

it("preserves attachments integration contracts", () => {
  expect(migratedAttachmentsFeatureStyles).toMatch(
    /sheetHeaderIconSlot: \{[^}]*width: controlSize\.compact[^}]*height: controlSize\.compact[^}]*flexShrink: 0/u,
  );
  expect(migratedAttachmentDocumentPreview).toContain(
    "language={nativeCodeLanguageForPath(document.request.path)}",
  );
  expect(migratedAttachmentVisibility).toContain('loadResources?.(undefined, "attachments")');
  expect(migratedAttachmentPreview).toContain("useThreadResources(");
});

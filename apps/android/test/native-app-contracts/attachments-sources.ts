import { readFileSync } from "node:fs";

export const migratedAttachmentVisibility = readFileSync(
  new URL("../../src/features/attachments/attachmentVisibility.ts", import.meta.url),
  "utf8",
);
export const migratedDocumentNavigation = readFileSync(
  new URL("../../src/features/attachments/documentNavigation.ts", import.meta.url),
  "utf8",
);
export const migratedAttachmentDocumentPreview = readFileSync(
  new URL("../../src/features/attachments/AttachmentDocumentPreview.tsx", import.meta.url),
  "utf8",
);
export const migratedAttachmentsFeature = readFileSync(
  new URL("../../src/features/attachments/AttachmentsFeature.tsx", import.meta.url),
  "utf8",
);
export const migratedAttachmentPreview = readFileSync(
  new URL("../../src/features/attachments/attachmentPreview.tsx", import.meta.url),
  "utf8",
);
export const migratedAttachmentsFeatureStyles = readFileSync(
  new URL("../../src/features/attachments/AttachmentsFeature.styles.ts", import.meta.url),
  "utf8",
);

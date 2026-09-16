import type { ImageDraftTarget } from "../data/quickdraw-attachment";

/** One image and its optional review, download, and drawing capabilities. */
export type ImagePreviewItem = {
  download?: (() => Promise<void>) | null;
  draft?: ImageDraftTarget;
  id: string;
  label: string;
  link?: string | null;
  order?: number;
  reference?: string | null;
  source: { headers?: Record<string, string>; uri: string };
};

/** An image-preview activation optionally associated with a registered gallery. */
export type ImagePreviewRequest = ImagePreviewItem & {
  groupId?: string | null;
};

/** Opens a preview image in the drawing workflow and reports attachment completion. */
export type ImageAnnotationHandler = (
  item: ImagePreviewItem,
  onAttached: () => void,
) => Promise<void>;

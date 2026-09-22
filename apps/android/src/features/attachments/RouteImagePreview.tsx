import { useContext } from "react";

import { ImagePreviewContext } from "../../rendering/imagePreviewController";
import type { PrivateImageDetailRequest } from "../../rendering/use-private-image-uri";

/** Renders one Router-owned image with the existing review and annotation capabilities. */
export function RouteImagePreview({
  detail,
  download,
  id,
  label,
  onClose,
  reference,
  source,
}: {
  readonly detail: PrivateImageDetailRequest | null;
  readonly download: () => Promise<void>;
  readonly id: string;
  readonly label: string;
  readonly onClose: () => void;
  readonly reference: string;
  readonly source: { readonly headers?: Record<string, string>; readonly uri: string };
}): React.ReactNode {
  const controller = useContext(ImagePreviewContext);
  const item = { detail, download, id, label, reference, source };
  return controller.createSession(item, onClose);
}

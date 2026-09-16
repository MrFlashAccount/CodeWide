import { useContext } from "react";

import { ImagePreviewContext } from "../../rendering/imagePreviewController";

/** Renders one Router-owned image with the existing review and annotation capabilities. */
export function RouteImagePreview({
  download,
  id,
  label,
  onClose,
  reference,
  source,
}: {
  readonly download: () => Promise<void>;
  readonly id: string;
  readonly label: string;
  readonly onClose: () => void;
  readonly reference: string;
  readonly source: { readonly headers?: Record<string, string>; readonly uri: string };
}): React.ReactNode {
  const controller = useContext(ImagePreviewContext);
  const item = { download, id, label, reference, source };
  return controller.createSession(item, onClose);
}

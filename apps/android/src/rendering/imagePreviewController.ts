import { createContext, type ReactElement } from "react";

import type { AppFullscreenOverlayController } from "../ui/AppFullscreenOverlay";
import type { ImageAnnotationHandler, ImagePreviewRequest } from "./imagePreviewTypes";

/** Coordinates image registrations, annotations, overlays, and route-owned surfaces. */
export type ImagePreviewController = {
  createSession: (request: ImagePreviewRequest, onClose: () => void) => ReactElement;
  open: (request: ImagePreviewRequest, fullscreen: AppFullscreenOverlayController) => void;
  register: (groupId: string, item: ImagePreviewRequest) => () => void;
  registerAnnotationHandler: (handler: ImageAnnotationHandler) => () => void;
};

/** Shared image-preview capability used by overlay and Router presentations. */
export const ImagePreviewContext = createContext<ImagePreviewController>({
  createSession: () => {
    throw new Error("ImagePreviewHost is missing");
  },
  open: () => undefined,
  register: () => () => undefined,
  registerAnnotationHandler: () => () => undefined,
});

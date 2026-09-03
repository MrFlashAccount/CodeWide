import type { ComponentType } from "react";

import type { PreviewStreamSource } from "../../application/preview/previewTransport";

export interface VideoPlayerCapabilityProps {
  autoplay: boolean;
  onRefreshSource?: () => void | Promise<void>;
  source: PreviewStreamSource;
  title: string;
}

export interface WebPreviewCapabilityProps {
  html: string;
  title: string;
}

export interface AttachmentRendererCapabilities {
  Player: ComponentType<VideoPlayerCapabilityProps>;
  WebPreview: ComponentType<WebPreviewCapabilityProps>;
}

import type { ReactNode } from "react";

import { DownloadManagerProvider } from "../data/DownloadManagerProvider";
import { getProcessDownloadManager } from "../data/processDownloadManager";
import { DocumentPreviewHost } from "../rendering/DocumentPreviewHost";
import { ContentReviewHost } from "../rendering/ContentReviewHost";
import { ImagePreviewHost } from "../rendering/ImagePreviewHost";
import { AppDialogProvider } from "./AppDialog";
import { AppFullscreenOverlayHost, AppFullscreenOverlayProvider } from "./AppFullscreenOverlay";
import { AppNoticeProvider } from "./AppNotice";

/** Owns application-wide downloads, dialogs, previews, reviews, and fullscreen overlays. */
export function AppRootProviders({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <DownloadManagerProvider manager={getProcessDownloadManager()}>
      <AppNoticeProvider>
        <DialogLayer>{children}</DialogLayer>
      </AppNoticeProvider>
    </DownloadManagerProvider>
  );
}

function DialogLayer({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <AppDialogProvider>
      <FullscreenLayer>{children}</FullscreenLayer>
    </AppDialogProvider>
  );
}

function FullscreenLayer({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <AppFullscreenOverlayProvider>
      <ReviewLayer>{children}</ReviewLayer>
    </AppFullscreenOverlayProvider>
  );
}

function ReviewLayer({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <ContentReviewHost>
      <PreviewLayer>{children}</PreviewLayer>
    </ContentReviewHost>
  );
}

function PreviewLayer({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <ImagePreviewHost>
      <DocumentPreviewHost>
        {children}
        <AppFullscreenOverlayHost />
      </DocumentPreviewHost>
    </ImagePreviewHost>
  );
}

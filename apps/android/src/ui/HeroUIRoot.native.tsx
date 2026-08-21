import { PortalHost } from "heroui-native/portal";
import { HeroUINativeProviderRaw } from "heroui-native/provider-raw";
import { ToastProvider } from "heroui-native/toast";
import type { ReactNode } from "react";
import { Uniwind } from "uniwind";

import { DocumentPreviewHost } from "../rendering/DocumentPreviewHost";
import { ContentReviewHost } from "../rendering/ContentReviewHost";
import { ImagePreviewHost } from "../rendering/ImagePreviewHost";
import { AppDialogProvider } from "./AppDialog";
import { AppFullscreenOverlayHost, AppFullscreenOverlayProvider } from "./AppFullscreenOverlay";
import { NavigationPerformanceHud } from "./NavigationPerformanceHud";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";

// The product is dark-only today. Pin Uniwind explicitly because HeroUI
// portals are mounted outside the themed screen subtree and otherwise fall
// back to the device color scheme.
Uniwind.setTheme("dark");

export function HeroUIRoot({ children }: { children: ReactNode }) {
  return (
    <HeroUINativeProviderRaw
      config={{
        devInfo: { stylingPrinciples: false },
        textProps: { allowFontScaling: true, maxFontSizeMultiplier: APP_MAX_FONT_SIZE_MULTIPLIER },
        textInputProps: { allowFontScaling: true, maxFontSizeMultiplier: APP_MAX_FONT_SIZE_MULTIPLIER },
      }}
    >
      <ToastProvider
        defaultProps={{ placement: "bottom", isSwipeable: true }}
        insets={{ left: 16, right: 16 }}
        maxVisibleToasts={2}
      >
        <AppDialogProvider>
          <AppFullscreenOverlayProvider>
            <ContentReviewHost>
              <ImagePreviewHost>
                <DocumentPreviewHost>
                  {children}
                  <NavigationPerformanceHud />
                  <PortalHost />
                  <AppFullscreenOverlayHost />
                </DocumentPreviewHost>
              </ImagePreviewHost>
            </ContentReviewHost>
          </AppFullscreenOverlayProvider>
        </AppDialogProvider>
      </ToastProvider>
    </HeroUINativeProviderRaw>
  );
}

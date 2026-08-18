import { PortalHost } from "heroui-native/portal";
import { HeroUINativeProviderRaw } from "heroui-native/provider-raw";
import type { ReactNode } from "react";
import { Uniwind } from "uniwind";

import { DocumentPreviewHost } from "../rendering/DocumentPreviewHost";
import { ImagePreviewHost } from "../rendering/ImagePreviewHost";
import { AppDialogProvider } from "./AppDialog";
import { AppFullscreenOverlayHost, AppFullscreenOverlayProvider } from "./AppFullscreenOverlay";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";

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
      <AppDialogProvider>
        <AppFullscreenOverlayProvider>
          <ImagePreviewHost>
            <DocumentPreviewHost>
              {children}
              <PortalHost />
              <AppFullscreenOverlayHost />
            </DocumentPreviewHost>
          </ImagePreviewHost>
        </AppFullscreenOverlayProvider>
      </AppDialogProvider>
    </HeroUINativeProviderRaw>
  );
}

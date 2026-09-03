import { useSyncExternalStore } from "react";

import type { UiGeneration } from "./uiGeneration";
import {
  v2NavigationDiagnosticsSource,
  v2PerformanceDiagnosticsSource,
} from "./v2DiagnosticsSources";
import { NavigationPerformanceHud as LegacyNavigationPerformanceHud } from "../ui/NavigationPerformanceHud";
import { useAppFullscreenOverlay } from "../ui/AppFullscreenOverlay";
import { NavigationDiagnosticsFeature } from "../v2/features/diagnostics/NavigationDiagnosticsFeature";
import { PerformanceDiagnosticsFeature } from "../v2/features/diagnostics/PerformanceDiagnosticsFeature";
import type { SpeedscopeProfileDocument } from "../v2/features/diagnostics/diagnosticsTypes";
import { V2PresentationProvider } from "../v2/platform/rendering/V2PresentationProvider";
import { SpeedscopeProfileViewer } from "../v2/presentation/diagnostics/SpeedscopeProfileViewer";
import { useEvent } from "../react/useEvent";

interface UiGenerationDiagnosticsHostProps {
  generation: UiGeneration | null;
}

/** Selects one diagnostics HUD so enabling metrics never renders V1 and V2 overlays together. */
export function UiGenerationDiagnosticsHost(
  props: UiGenerationDiagnosticsHostProps,
): React.JSX.Element | null {
  if (props.generation === "legacy") return <LegacyNavigationPerformanceHud />;
  if (props.generation === "v2") return <V2NavigationDiagnosticsHost />;
  return null;
}

/** Adapts the existing Data for geeks source into the V2 settings surface. */
export function V2PerformanceDiagnostics(): React.JSX.Element {
  return <PerformanceDiagnosticsFeature source={v2PerformanceDiagnosticsSource} />;
}

function V2NavigationDiagnosticsHost(): React.JSX.Element {
  const metrics = useSyncExternalStore(
    v2PerformanceDiagnosticsSource.subscribe,
    v2PerformanceDiagnosticsSource.snapshot,
    v2PerformanceDiagnosticsSource.snapshot,
  ).native;
  const fullscreen = useAppFullscreenOverlay({
    lifecycle: null,
    scope: "v2-navigation-performance",
  });
  const openProfile = useEvent((document: SpeedscopeProfileDocument) => {
    fullscreen.present(
      (controls) => (
        <V2PresentationProvider>
          <SpeedscopeProfileViewer
            content={document.content}
            fileName={document.fileName}
            onClose={controls.close}
            title={document.title}
          />
        </V2PresentationProvider>
      ),
      { dismissOnScopeUnmount: false },
    );
  });
  return (
    <V2PresentationProvider>
      <NavigationDiagnosticsFeature
        metrics={metrics}
        onOpenProfile={openProfile}
        source={v2NavigationDiagnosticsSource}
      />
    </V2PresentationProvider>
  );
}

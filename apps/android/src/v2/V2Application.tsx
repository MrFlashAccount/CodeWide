import { useState, type PropsWithChildren } from "react";

import { V2RuntimeProvider } from "./application/react/V2RuntimeContext";
import {
  TerminalPlatformProvider,
  type TerminalPlatform,
} from "./application/react/TerminalPlatformContext";
import { createV2Runtime } from "./createV2Runtime";
import { useV2RuntimeLifecycle } from "./infrastructure/react/useV2RuntimeLifecycle";
import { TerminalRendererView } from "./infrastructure/react/terminal/TerminalRendererView";
import { TerminalRouteBinding } from "./infrastructure/react/terminal/TerminalRouteBinding";
import { V2RenderRecoveryProvider } from "./features/diagnostics/V2RenderRecoveryProvider";
import { AppDialogProvider } from "./ui/AppDialog";
import { ActionRunner } from "./ui/actions/ActionRunner";
import { ResourceStateView } from "./presentation/feedback/ResourceStateView";
import { useEvent } from "../react/useEvent";

export { useV2Runtime } from "./application/react/V2RuntimeContext";

const TERMINAL_PLATFORM: TerminalPlatform = {
  Renderer: TerminalRendererView,
  RouteBinding: TerminalRouteBinding,
};

export function V2Application(props: PropsWithChildren<{ active: boolean }>): React.JSX.Element {
  const { active, children } = props;
  const [runtime, setRuntime] = useState(createV2Runtime);
  const lifecycle = useV2RuntimeLifecycle(runtime, active);
  const retry = useEvent((): void => setRuntime(() => createV2Runtime()));
  if (active && lifecycle.status !== "ready") {
    return (
      <ResourceStateView
        message={lifecycle.status === "error" ? lifecycle.message : "Starting CodeWide V2…"}
        onRetry={retry}
        status={lifecycle.status === "error" ? "error" : "loading"}
      />
    );
  }
  return (
    <V2RuntimeProvider runtime={runtime}>
      <TerminalPlatformProvider platform={TERMINAL_PLATFORM}>
        <AppDialogProvider>
          <V2RenderRecoveryProvider>
            <ActionRunner>{children}</ActionRunner>
          </V2RenderRecoveryProvider>
        </AppDialogProvider>
      </TerminalPlatformProvider>
    </V2RuntimeProvider>
  );
}

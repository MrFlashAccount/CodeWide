import { useState, type PropsWithChildren } from "react";

import { V2RuntimeProvider } from "./application/react/V2RuntimeContext";
import { createV2Runtime } from "./createV2Runtime";
import { useV2RuntimeLifecycle } from "./infrastructure/react/useV2RuntimeLifecycle";
import { AppDialogProvider } from "./ui/AppDialog";
import { ActionRunner } from "./ui/actions/ActionRunner";

export { useV2Runtime } from "./application/react/V2RuntimeContext";

export function V2Application(props: PropsWithChildren<{ active: boolean }>): React.JSX.Element {
  const { active, children } = props;
  const [runtime] = useState(createV2Runtime);
  useV2RuntimeLifecycle(runtime, active);
  return (
    <V2RuntimeProvider runtime={runtime}>
      <AppDialogProvider>
        <ActionRunner>{children}</ActionRunner>
      </AppDialogProvider>
    </V2RuntimeProvider>
  );
}

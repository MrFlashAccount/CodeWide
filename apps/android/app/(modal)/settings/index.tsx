import { useSyncExternalStore } from "react";
import { router } from "expo-router";

import { UiGenerationControl } from "../../../src/boot/UiGenerationControl";
import {
  subscribeUiGeneration,
  uiGenerationSnapshot,
} from "../../../src/boot/uiGenerationResource";
import { SettingsScreen } from "../../../src/v2/features/settings/SettingsScreen";
import { useEvent } from "../../../src/react/useEvent";
import appConfig from "../../../app.json";
import { V2PerformanceDiagnostics } from "../../../src/boot/UiGenerationDiagnosticsHost";

export default function SettingsRoute(): React.JSX.Element {
  const close = useEvent(() => router.back());
  const snapshot = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  return (
    <SettingsScreen
      diagnostics={<V2PerformanceDiagnostics />}
      generationControl={
        snapshot.status === "ready" ? <UiGenerationControl current={snapshot.generation} /> : null
      }
      onClose={close}
      version={appConfig.expo.version}
    />
  );
}

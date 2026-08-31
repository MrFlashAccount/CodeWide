import { useSyncExternalStore } from "react";

import { UiGenerationControl } from "../../../src/boot/UiGenerationControl";
import {
  subscribeUiGeneration,
  uiGenerationSnapshot,
} from "../../../src/boot/uiGenerationResource";
import { SettingsScreen } from "../../../src/v2/features/settings/SettingsScreen";

export default function SettingsRoute(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  return (
    <SettingsScreen
      generationControl={
        snapshot.status === "ready" ? <UiGenerationControl current={snapshot.generation} /> : null
      }
    />
  );
}

import { useSelector } from "@legendapp/state/react";

import type { GlobalVoiceOrbStyle } from "../../data/globalVoiceOrbStyle";
import {
  globalVoiceOrbStyle$,
  writeGlobalVoiceOrbStylePreference,
} from "../../data/globalVoiceOrbStylePreference";
import { useEvent } from "../../react/useEvent";

/** Reads, persists and live-applies the independent Voice Assistant renderer choice. */
export function useGlobalVoiceOrbStyle(): {
  readonly selectedStyle: GlobalVoiceOrbStyle;
  readonly selectStyle: (style: GlobalVoiceOrbStyle) => Promise<void>;
} {
  const selectedStyle = useSelector(globalVoiceOrbStyle$);
  const selectStyle = useEvent(async (style: GlobalVoiceOrbStyle) => {
    await writeGlobalVoiceOrbStylePreference(style);
  });
  return { selectedStyle, selectStyle };
}

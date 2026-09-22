import type { ViewProps } from "react-native";

import type { GlobalVoiceOrbStyle } from "../data/globalVoiceOrbStyle";
import type { GlobalVoiceOrbState } from "../native/globalVoiceOverlayActions";

export type VoiceAssistantOrbProps = ViewProps & {
  readonly inputLevel?: number;
  readonly orbState: GlobalVoiceOrbState;
  readonly orbStyle: GlobalVoiceOrbStyle;
  readonly playbackLevel?: number;
};

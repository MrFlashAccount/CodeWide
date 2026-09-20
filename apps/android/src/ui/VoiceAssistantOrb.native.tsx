import { requireNativeComponent } from "react-native";

import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import type { VoiceAssistantOrbProps } from "./VoiceAssistantOrb.types";

export type { VoiceAssistantOrbProps } from "./VoiceAssistantOrb.types";

type NativeVoiceAssistantOrbProps = VoiceAssistantOrbProps & {
  readonly reducedMotion: boolean;
};

const NativeVoiceAssistantOrb = requireNativeComponent<NativeVoiceAssistantOrbProps>(
  "CodeWideVoiceAssistantOrb",
);

/** In-app surface backed by the same renderer strategies as the floating overlay. */
export function VoiceAssistantOrb(props: VoiceAssistantOrbProps): React.JSX.Element {
  const reducedMotion = useReducedMotionPreference();
  return <NativeVoiceAssistantOrb {...props} reducedMotion={reducedMotion} />;
}

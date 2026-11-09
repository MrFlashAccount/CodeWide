import Reanimated from "react-native-reanimated";

import { NewThreadFloatingButton } from "../projects/NewThreadFloatingButton";
import { styles } from "./ThreadListFab.styles";
import { GlobalVoiceEntryAction, type GlobalVoiceControl } from "./GlobalVoiceEntryAction";
import { useThreadListFabModel, type ThreadListFabModel } from "./threadListFabModel";
import { useThreadListFabMotion } from "./threadListFabMotion";

/** Scroll-hidden actions take no touches and leave the accessibility tree. */
function hiddenProps(hidden: boolean) {
  return {
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden ? ("no-hide-descendants" as const) : ("auto" as const),
    pointerEvents: hidden ? ("none" as const) : ("box-none" as const),
  };
}

/** The list-scoped New thread action; it hides with the list's scroll direction. */
export function ThreadListNewThreadFab({
  model,
  onNewThread,
  projectName,
}: {
  readonly model: ThreadListFabModel;
  readonly onNewThread: () => void;
  readonly projectName: string | null;
}): React.JSX.Element {
  const motion = useThreadListFabMotion(model, "primary", false);
  return (
    <Reanimated.View
      {...hiddenProps(motion.hidden)}
      style={[styles.primary, motion.style]}
      testID="new-thread-fab-slot"
    >
      <NewThreadFloatingButton onPress={onNewThread} projectName={projectName} />
    </Reanimated.View>
  );
}

/**
 * The catalog's single Global Voice mini action above New thread. One
 * instance serves every list scope so the orb keeps its native view and the
 * overlay flights keep one measured anchor. It stays shown while a session
 * is active so the return flight lands on a visible anchor.
 */
export function ThreadListVoiceFab({
  globalVoice,
  primaryVisible,
}: {
  readonly globalVoice: GlobalVoiceControl | null;
  readonly primaryVisible: boolean;
}): React.JSX.Element | null {
  const model = useThreadListFabModel();
  const motion = useThreadListFabMotion(
    model,
    "secondary",
    globalVoice !== null && globalVoice.state !== "idle",
  );
  if (globalVoice === null) {
    return null;
  }
  return (
    <Reanimated.View
      {...hiddenProps(motion.hidden)}
      style={[primaryVisible ? styles.secondaryAbovePrimary : styles.secondaryAlone, motion.style]}
      testID="global-voice-fab-slot"
    >
      {/* A placement change moves only this wrapper, which fires no layout event in the
          anchor; remounting re-stages the measured launch origin at the new position. */}
      <GlobalVoiceEntryAction key={primaryVisible ? "above" : "alone"} {...globalVoice} />
    </Reanimated.View>
  );
}

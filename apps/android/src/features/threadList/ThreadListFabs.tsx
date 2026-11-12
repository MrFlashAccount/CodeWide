import Reanimated from "react-native-reanimated";

import { NewThreadFloatingButton } from "../projects/NewThreadFloatingButton";
import { styles } from "./ThreadListFab.styles";
import { GlobalVoiceEntryAction, type GlobalVoiceControl } from "./GlobalVoiceEntryAction";
import { useThreadListFabModel } from "./threadListFabModel";
import { useThreadListFabMotion } from "./threadListFabMotion";

/** The open catalog scope's New thread action; `projectName` is `null` in the root scope. */
type ThreadListNewThreadAction = {
  readonly onPress: () => void;
  readonly projectName: string | null;
};

/** Scroll-hidden actions take no touches and leave the accessibility tree. */
function hiddenProps(hidden: boolean) {
  return {
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden ? ("no-hide-descendants" as const) : ("auto" as const),
    pointerEvents: hidden ? ("none" as const) : ("box-none" as const),
  };
}

/**
 * The catalog's single floating stack: Global Voice above New thread. One
 * instance serves every list scope, so navigating between the root, a project
 * and the archived view never remounts it; the open scope only changes its
 * `newThread` action. `null` (archived scope) removes New thread and the voice
 * action takes its slot on the same axis.
 */
export function ThreadListFabStack({
  globalVoice,
  newThread,
}: {
  readonly globalVoice: GlobalVoiceControl | null;
  readonly newThread: ThreadListNewThreadAction | null;
}): React.JSX.Element {
  return (
    <>
      <ThreadListVoiceFab globalVoice={globalVoice} primaryVisible={newThread !== null} />
      {newThread === null ? null : <ThreadListNewThreadFab action={newThread} />}
    </>
  );
}

/** New thread for the open scope; it hides with the focused list's scroll direction. */
function ThreadListNewThreadFab({
  action,
}: {
  readonly action: ThreadListNewThreadAction;
}): React.JSX.Element {
  const motion = useThreadListFabMotion(useThreadListFabModel(), "primary", false);
  return (
    <Reanimated.View
      {...hiddenProps(motion.hidden)}
      style={[styles.primary, motion.style]}
      testID="new-thread-fab-slot"
    >
      <NewThreadFloatingButton onPress={action.onPress} projectName={action.projectName} />
    </Reanimated.View>
  );
}

/**
 * The Global Voice mini action. It keeps one native orb view and one measured
 * anchor for the overlay flights, and stays shown while a session is active so
 * the return flight lands on a visible anchor.
 */
function ThreadListVoiceFab({
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

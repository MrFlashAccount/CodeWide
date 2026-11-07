import { Switch, type SwitchProps } from "react-native";

import { appSwitchColors } from "./appSwitchColors";

/**
 * Switch in the neutral theme palette for both states. It keeps every native
 * Switch prop, so accessibility and disabled behavior are unchanged.
 */
export function AppSwitch(
  props: Omit<SwitchProps, "ios_backgroundColor" | "thumbColor" | "trackColor">,
): React.JSX.Element {
  return (
    <Switch
      {...props}
      ios_backgroundColor={appSwitchColors.track.false}
      thumbColor={props.value === true ? appSwitchColors.onThumb : appSwitchColors.offThumb}
      trackColor={appSwitchColors.track}
    />
  );
}

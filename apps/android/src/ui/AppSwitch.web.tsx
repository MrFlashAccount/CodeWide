import { Switch, type SwitchProps } from "react-native";

import { appSwitchColors } from "./appSwitchColors";

/** react-native-web paints the on thumb from its own `activeThumbColor` (teal by default). */
type WebSwitchProps = SwitchProps & { readonly activeThumbColor?: string };

// A component accepting SwitchProps also accepts the wider web props type; no assertion needed.
const WebSwitch: React.ComponentType<WebSwitchProps> = Switch;

/** Web rendering of the theme switch: same colors for both states. */
export function AppSwitch(
  props: Omit<SwitchProps, "ios_backgroundColor" | "thumbColor" | "trackColor">,
): React.JSX.Element {
  return (
    <WebSwitch
      {...props}
      activeThumbColor={appSwitchColors.onThumb}
      thumbColor={appSwitchColors.offThumb}
      trackColor={appSwitchColors.track}
    />
  );
}

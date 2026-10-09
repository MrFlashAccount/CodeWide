import Svg, { Path } from "react-native-svg";

import { colors, iconSize } from "../../theme";
import type { GoalMenuAction } from "./goalMenuLifecycle";

type GoalIconAction = GoalMenuAction | "edit";

const paths: Readonly<Record<GoalIconAction, string>> = {
  edit: "M14.5 5.5 18.5 9.5 M4 20 5 15 16.5 3.5 a2.83 2.83 0 0 1 4 4 L9 19 Z",
  pause: "M6 5 H10 V19 H6 Z M14 5 H18 V19 H14 Z",
  resume: "M7 4.5 L20 12 L7 19.5 Z",
  stop: "M6.5 5 H17.5 Q19 5 19 6.5 V17.5 Q19 19 17.5 19 H6.5 Q5 19 5 17.5 V6.5 Q5 5 6.5 5 Z",
};

/** Feature-local vector glyphs have no font baseline or Android font-padding dependency. */
export function GoalMenuIcon({ action }: { readonly action: GoalIconAction }): React.JSX.Element {
  const color = action === "stop" ? colors.red : colors.text;
  const outlined = action === "edit";
  return (
    <Svg accessible={false} height={iconSize.action} viewBox="0 0 24 24" width={iconSize.action}>
      <Path
        d={paths[action]}
        fill={outlined ? "none" : color}
        stroke={outlined ? color : "none"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
      />
    </Svg>
  );
}

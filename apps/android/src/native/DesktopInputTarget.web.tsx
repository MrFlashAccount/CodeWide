import { useImperativeHandle } from "react";
import { View } from "react-native";
import type { DesktopInputTargetProps } from "./desktopInputContract";
import { styles } from "./DesktopInputTarget.styles";

/** Preserves children without advertising Android input capabilities on web. */
export function DesktopInputTarget({ children, ref }: DesktopInputTargetProps): React.JSX.Element {
  useImperativeHandle(
    ref,
    () => ({
      click: () => {
        throw new Error("Android mouse input is unavailable on web");
      },
      keyboard: () => {
        throw new Error("Android keyboard input is unavailable on web");
      },
      sendKey: () => {
        throw new Error("Android keyboard input is unavailable on web");
      },
    }),
    [],
  );
  return <View style={styles.target}>{children}</View>;
}

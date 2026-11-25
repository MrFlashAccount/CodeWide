import { useContext, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";

import { WorkspaceSafeInsetsContext } from "./workspaceSafeInsets";

/** Insets interactive content within its pane, leaving the surrounding pane surface edge to edge. */
export function WorkspaceSafeContent({
  children,
}: {
  readonly children: ReactElement;
}): ReactElement {
  const { bottom, top } = useContext(WorkspaceSafeInsetsContext);
  return <View style={[styles.content, { marginBottom: bottom, marginTop: top }]}>{children}</View>;
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    // Shrinking a pane must also shrink its interactive viewport.
    minHeight: 0,
    minWidth: 0,
  },
});

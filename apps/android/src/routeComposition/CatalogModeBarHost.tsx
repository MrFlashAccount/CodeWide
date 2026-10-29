import { StyleSheet, View } from "react-native";

import { CatalogModeBar, type CatalogMode } from "../features/pullRequests/CatalogModeBar";
import {
  catalogModeBarBottomInset,
  catalogModeBarHorizontalInset,
} from "../presentation/layouts/catalogModeBarGeometry";
import { useEvent } from "../react/useEvent";
import { useWorkspaceTabSceneNavigation } from "./workspaceTabSceneNavigation";

const FLOATING_MODE_BAR_Z_INDEX = 20;

/** Renders the controlled Reacticx bar inside the active catalog master's local bounds. */
export function CatalogModeBarHost({
  mode,
}: {
  readonly mode: CatalogMode;
}): React.JSX.Element | null {
  const navigation = useWorkspaceTabSceneNavigation();
  const activateMode = useEvent((selectedMode: CatalogMode): void => {
    navigation.activate(selectedMode);
  });
  if (!navigation.tabActive) {
    return null;
  }
  return (
    <View pointerEvents="box-none" style={styles.bar} testID="floating-catalog-mode-bar">
      <CatalogModeBar mode={mode} onSelect={activateMode} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    bottom: catalogModeBarBottomInset,
    left: catalogModeBarHorizontalInset,
    position: "absolute",
    right: catalogModeBarHorizontalInset,
    zIndex: FLOATING_MODE_BAR_Z_INDEX,
  },
});

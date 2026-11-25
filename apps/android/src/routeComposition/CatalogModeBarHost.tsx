import { useContext } from "react";
import { StyleSheet } from "react-native";

import { CatalogModeBar, type CatalogMode } from "../features/pullRequests/CatalogModeBar";
import {
  CatalogNavigationInsetContext,
  catalogModeBarBottomInset,
  catalogModeBarHorizontalInset,
} from "../presentation/layouts/catalogModeBarGeometry";
import { useWorkspaceTabsNavigation } from "./workspaceTabSceneNavigation";
import { PaneChrome } from "../ui/PaneChrome";

const FLOATING_MODE_BAR_Z_INDEX = 20;

/** Keeps the measured control in its catalog so its selection spring survives tab switches. */
export function CatalogModeBarHost({
  mode,
}: {
  readonly mode: CatalogMode;
}): React.JSX.Element | null {
  const { activate, activeMode } = useWorkspaceTabsNavigation();
  const bottom = useContext(CatalogNavigationInsetContext);
  if (activeMode === null) {
    return null;
  }
  return (
    <PaneChrome
      pointerEvents="box-none"
      style={[styles.bar, { bottom: catalogModeBarBottomInset + bottom }]}
      testID="floating-catalog-mode-bar"
    >
      <CatalogModeBar active={activeMode === mode} mode={activeMode} onSelect={activate} />
    </PaneChrome>
  );
}

const styles = StyleSheet.create({
  bar: {
    left: catalogModeBarHorizontalInset,
    position: "absolute",
    right: catalogModeBarHorizontalInset,
    zIndex: FLOATING_MODE_BAR_Z_INDEX,
  },
});

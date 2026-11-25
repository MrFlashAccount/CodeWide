import { useContext, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";
import { CatalogNavigationInsetContext } from "../presentation/layouts/catalogModeBarGeometry";
import { WorkspaceSafeInsetsContext } from "./workspaceSafeInsets";
import { CatalogModeBarHost } from "./CatalogModeBarHost";

/** Composes one anchored catalog descriptor with its local active-tab navigation control. */
export function WorkspaceCatalogMaster({
  children,
  mode,
  navigationAvailable = true,
}: {
  readonly children: ReactElement | null;
  readonly mode: CatalogMode;
  readonly navigationAvailable?: boolean;
}): React.JSX.Element | null {
  const { bottom, top } = useContext(WorkspaceSafeInsetsContext);
  if (children === null) {
    return null;
  }
  return (
    <CatalogNavigationInsetContext.Provider value={navigationAvailable ? bottom : 0}>
      <View
        style={[styles.master, { marginBottom: navigationAvailable ? 0 : bottom, marginTop: top }]}
        testID={`workspace-catalog-master-${mode}`}
      >
        {children}
        {navigationAvailable ? <CatalogModeBarHost mode={mode} /> : null}
      </View>
    </CatalogNavigationInsetContext.Provider>
  );
}

const styles = StyleSheet.create({
  master: {
    flex: 1,
    minWidth: 0,
    position: "relative",
  },
});

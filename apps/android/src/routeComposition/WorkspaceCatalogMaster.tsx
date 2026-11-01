import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";
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
  if (children === null) {
    return null;
  }
  return (
    <View style={styles.master} testID={`workspace-catalog-master-${mode}`}>
      {children}
      {navigationAvailable ? <CatalogModeBarHost mode={mode} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  master: {
    flex: 1,
    minWidth: 0,
    position: "relative",
  },
});

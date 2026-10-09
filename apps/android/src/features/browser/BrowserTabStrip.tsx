import { useSelector } from "@legendapp/state/react";
import { View } from "react-native";
import { browserTabsInOrder, type BrowserTabsModel } from "../../services/browser/browserTabsModel";
import { WorkspaceTabStrip } from "../../ui/WorkspaceTabStrip";
import { BrowserTabButton } from "./BrowserTabButton";
import { styles } from "./BrowserWorkspace.styles";

/** Exposes selection, creation and close independently from native page mounting. */
export function BrowserTabStrip(props: {
  readonly onNewTab: () => void;
  readonly tabs: BrowserTabsModel;
}): React.JSX.Element {
  const snapshot = useSelector(props.tabs.state$);
  const selectedId = snapshot.kind === "tabs" ? snapshot.selected.id : null;
  return (
    <View style={styles.tabBar}>
      <WorkspaceTabStrip compact newTabLabel="New browser tab" onNewTab={props.onNewTab}>
        {Array.from(browserTabsInOrder(snapshot), (tab) => (
          <BrowserTabButton
            key={tab.id.value}
            model={props.tabs}
            selected={tab.id === selectedId}
            tab={tab}
          />
        ))}
      </WorkspaceTabStrip>
    </View>
  );
}

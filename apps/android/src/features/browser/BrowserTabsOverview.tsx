import { useSelector } from "@legendapp/state/react";
import { FlatList, View } from "react-native";
import type { BrowserTab } from "../../services/browser/browserTab";
import { browserTabsInOrder, type BrowserTabsModel } from "../../services/browser/browserTabsModel";
import { AppText } from "../../ui/Typography";
import { WorkspaceTabsEmptyState } from "../../ui/WorkspaceTabsEmptyState";
import { BrowserButton } from "./BrowserButton";
import { BrowserTabButton } from "./BrowserTabButton";
import { styles } from "./BrowserTabsOverview.styles";

const WIDE_GRID_COLUMNS = 4;
const PHONE_GRID_COLUMNS = 2;

/** Local tab manager; the page owners stay mounted behind its grid or list. */
export function BrowserTabsOverview(props: {
  readonly grid: boolean;
  readonly onNewTab: () => void;
  readonly onSelect: () => void;
  readonly onToggleLayout: () => void;
  readonly tabs: BrowserTabsModel;
  readonly wide: boolean;
}): React.JSX.Element {
  const snapshot = useSelector(props.tabs.state$);
  // FlatList requires an indexable array; the model's private owners are not cloned.
  const tabs = Array.from(browserTabsInOrder(snapshot));
  const columns = props.grid ? (props.wide ? WIDE_GRID_COLUMNS : PHONE_GRID_COLUMNS) : 1;
  function renderTab({ item }: { readonly item: BrowserTab }): React.JSX.Element {
    return (
      <View
        style={props.grid ? (props.wide ? styles.wideGridCell : styles.gridCell) : styles.listCell}
      >
        <BrowserTabButton
          layout={props.grid ? "grid" : "list"}
          model={props.tabs}
          onSelect={props.onSelect}
          selected={snapshot.kind === "tabs" && snapshot.selected === item}
          tab={item}
        />
      </View>
    );
  }
  return (
    <View style={styles.root} testID="browser-tabs-overview">
      <OverviewHeader
        count={tabs.length}
        grid={props.grid}
        onNewTab={props.onNewTab}
        onToggleLayout={props.onToggleLayout}
      />
      <FlatList
        contentContainerStyle={[styles.list, tabs.length === 0 && styles.emptyList]}
        data={tabs}
        key={columns}
        keyExtractor={tabKey}
        ListEmptyComponent={
          <WorkspaceTabsEmptyState
            createLabel="New tab"
            onCreate={props.onNewTab}
            title="No tabs yet"
          />
        }
        numColumns={columns}
        renderItem={renderTab}
      />
    </View>
  );
}

function tabKey(tab: BrowserTab): string {
  return tab.id.value;
}

function OverviewHeader(props: {
  readonly count: number;
  readonly grid: boolean;
  readonly onNewTab: () => void;
  readonly onToggleLayout: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      <AppText style={styles.title}>Tabs · {props.count}</AppText>
      <BrowserButton
        compact
        icon={props.grid ? "list" : "grid-outline"}
        label={props.grid ? "Show tabs as list" : "Show tabs as grid"}
        onPress={props.onToggleLayout}
      />
      <BrowserButton compact icon="add" label="New browser tab" onPress={props.onNewTab} />
    </View>
  );
}

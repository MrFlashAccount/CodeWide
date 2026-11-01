import { Ionicons } from "@expo/vector-icons";
import { colors, iconSize } from "../../theme";
import { useEvent } from "../../react/useEvent";
import { AppList } from "../../ui/AppList";
import { AppListItem } from "../../ui/AppListItem";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { ServerIcon } from "../connections/ServerIcon";
import type { ProjectPickerServer, ScopedProjectPickerProps } from "./projectPickerContract";
import type { ProjectPickerSession } from "./projectPickerSession";
import { EmptyState } from "./ProjectPickerRowViews";
import { styles } from "./ProjectPickerSheet.styles";

function PickerServerRow({
  disabled,
  onBrowse,
  server,
}: {
  readonly disabled: boolean;
  readonly onBrowse: (connectionId: string | null) => void;
  readonly server: ProjectPickerServer;
}): React.JSX.Element {
  const browse = useEvent(() => {
    onBrowse(server.id);
  });
  return (
    <AppListItem
      accessibilityLabel={`Browse server: ${server.name}`}
      description={server.available ? "Browse folders" : "Offline"}
      disabled={disabled}
      fixedHeight={listRowHeight.double}
      leading={<ServerIcon iconId={server.iconId} metric="body" />}
      onPress={browse}
      title={server.name}
      trailing={<Ionicons color={colors.textDim} name="chevron-forward" size={iconSize.inline} />}
    />
  );
}

/** The browser's top level lists actual servers without treating All as a destination. */
export function ProjectServerContent({
  props,
  state,
}: {
  readonly props: ScopedProjectPickerProps;
  readonly state: ProjectPickerSession;
}): React.JSX.Element {
  const servers = props.servers.filter((server) =>
    server.name.toLocaleLowerCase().includes(state.normalizedQuery),
  );
  return (
    <AppList
      contentContainerStyle={styles.listContent}
      data={servers}
      empty={<EmptyState compact icon="server-outline" text="No matching servers" />}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(server) => server.id}
      renderItem={({ item }) => (
        <PickerServerRow
          disabled={props.busy || state.adding || !item.available}
          onBrowse={state.openDirectoryPicker}
          server={item}
        />
      )}
      scrollComponent={AppSheetScrollView}
      style={styles.projectScroll}
      virtualized
    />
  );
}

import { useSelector } from "@legendapp/state/react";
import { useState, type ReactElement } from "react";
import { View } from "react-native";

import { useDownloadManager } from "../../data/downloadManagerContext";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

/** Shows and changes the folder the download manager saves files to. */
export function DownloadSettings(): ReactElement {
  const manager = useDownloadManager();
  const folder = useSelector(() => manager.folder$.get());
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const change = useEvent((): void => {
    if (changing) {
      return;
    }
    setChanging(true);
    setChangeError(null);
    manager.changeFolder().then(
      () => {
        setChanging(false);
      },
      (error: unknown) => {
        setChangeError(error instanceof Error ? error.message : "Could not change download folder");
        setChanging(false);
      },
    );
  });
  return (
    <View testID="download-folder-setting">
      <AppListRow
        accessibilityLabel="Download location"
        description={folder === null ? "Ask on the first download" : folder.name}
        fixedHeight={listRowHeight.double}
        leadingIcon={{ color: colors.textMuted, name: "folder-outline", size: iconSize.action }}
        onPress={change}
        shimmering={changing}
        title="Download location"
      />
      {changeError !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {changeError}
        </Text>
      )}
    </View>
  );
}

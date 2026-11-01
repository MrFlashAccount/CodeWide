import { useSelector } from "@legendapp/state/react";
import { useState, type ReactElement } from "react";
import { ActivityIndicator, Switch, View } from "react-native";

import {
  peleDiagramRendererEnabled$,
  writePeleDiagramRendererPreference,
} from "../../data/peleDiagramRendererPreference";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

/** Owns the persisted opt-in interaction for native diagram rendering. */
export function PeleDiagramRendererSettings(): ReactElement {
  const enabled = useSelector(peleDiagramRendererEnabled$);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const changeEnabled = useEvent((nextEnabled: boolean) => {
    if (saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    void writePeleDiagramRendererPreference(nextEnabled).then(
      () => {
        setSaving(false);
      },
      (error: unknown) => {
        setSaveError(error instanceof Error ? error.message : "Could not update diagram renderer");
        setSaving(false);
      },
    );
  });
  return (
    <View testID="pele-diagram-renderer-setting">
      <AppListRow
        description="Render Mermaid diagrams as native SVG on a lazy worker instead of a WebView"
        fixedHeight={listRowHeight.double}
        leadingIcon={{
          color: colors.textMuted,
          name: "git-network-outline",
          size: iconSize.action,
        }}
        title="Pele diagram renderer"
        trailing={
          <PeleDiagramRendererToggle enabled={enabled} onChange={changeEnabled} saving={saving} />
        }
      />
      {saveError !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {saveError}
        </Text>
      )}
    </View>
  );
}

function PeleDiagramRendererToggle({
  enabled,
  onChange,
  saving,
}: {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
  readonly saving: boolean;
}): ReactElement {
  return (
    <>
      {saving && <ActivityIndicator color={colors.textMuted} size="small" />}
      <Switch
        accessibilityLabel="Pele diagram renderer"
        disabled={saving}
        onValueChange={onChange}
        value={enabled}
      />
    </>
  );
}

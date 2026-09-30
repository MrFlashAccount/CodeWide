import { useSelector } from "@legendapp/state/react";
import { useState, type ReactElement } from "react";
import { ActivityIndicator, Switch, View } from "react-native";

import {
  timelineRowPremeasurementEnabled$,
  writeTimelineRowPremeasurementPreference,
} from "../../data/timelineRowPremeasurementPreference";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

/** Owns the persisted opt-in interaction for experimental exact row sizing. */
export function TimelineRowMeasurementSettings(): ReactElement {
  const enabled = useSelector(timelineRowPremeasurementEnabled$);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const changeEnabled = useEvent((nextEnabled: boolean) => {
    if (saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    void writeTimelineRowPremeasurementPreference(nextEnabled).then(
      () => {
        setSaving(false);
      },
      (error: unknown) => {
        setSaveError(
          error instanceof Error ? error.message : "Could not update row measurement mode",
        );
        setSaving(false);
      },
    );
  });
  return (
    <View testID="timeline-row-premeasurement-setting">
      <AppListRow
        description="Estimate every row at 115 dp when off and let LegendList measure its layout"
        fixedHeight={listRowHeight.double}
        leadingIcon={{ color: colors.textMuted, name: "analytics-outline", size: iconSize.action }}
        title="Premeasure message heights"
        trailing={
          <TimelineRowMeasurementToggle
            enabled={enabled}
            onChange={changeEnabled}
            saving={saving}
          />
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

function TimelineRowMeasurementToggle({
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
        accessibilityLabel="Premeasure message heights"
        disabled={saving}
        onValueChange={onChange}
        value={enabled}
      />
    </>
  );
}

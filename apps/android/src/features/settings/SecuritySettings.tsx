import { useState } from "react";
import { ActivityIndicator, Switch, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { useAppLockSettings } from "../../ui/AppLockGate";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

/** Owns the biometric setting's local pending and failure interaction state. */
export function SecuritySettings(): React.JSX.Element {
  const appLock = useAppLockSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeAppLock = useEvent(async (enabled: boolean) => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await appLock.setEnabled(enabled);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update app lock");
    }
    setSaving(false);
  });

  return (
    <View testID="app-lock-setting">
      <AppListRow
        description="Use fingerprint, face or device authentication"
        fixedHeight={listRowHeight.double}
        leadingIcon={{ color: colors.textMuted, name: "finger-print", size: iconSize.action }}
        title="Biometric Lock"
        trailing={
          <AppLockToggle enabled={appLock.enabled} onChange={changeAppLock} saving={saving} />
        }
      />
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
}

function AppLockToggle({
  enabled,
  onChange,
  saving,
}: {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => Promise<void>;
  readonly saving: boolean;
}): React.JSX.Element {
  const change = useEvent((value: boolean) => {
    onChange(value).catch(() => undefined);
  });
  return (
    <>
      {saving && <ActivityIndicator color={colors.textMuted} size="small" />}
      <Switch
        accessibilityLabel="Biometric app lock"
        disabled={saving}
        onValueChange={change}
        value={enabled}
      />
    </>
  );
}

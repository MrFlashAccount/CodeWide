import { useSelector } from "@legendapp/state/react";
import { useRef, useState } from "react";
import { View } from "react-native";

import { globalVoiceAudioInputResource, selectVoiceInput } from "../../data/globalVoiceAudioInput";
import type {
  VoiceInputDevice,
  VoiceInputKind,
  VoiceInputSnapshot,
} from "../../native/globalVoiceAudioRouteContract";
import { useEvent } from "../../react/useEvent";
import { AppListRow } from "../../ui/AppListRow";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

const labels: Record<VoiceInputKind, string> = {
  ble: "Bluetooth LE microphone",
  bluetooth: "Bluetooth microphone",
  builtin: "Phone microphone",
  system: "System default",
  usb: "USB microphone",
  wired: "Wired microphone",
};

/** Presents saved route intent separately from the input Android actually reports. */
export function VoiceInputSettings({
  onSelect,
  snapshot,
}: {
  readonly onSelect: (kind: VoiceInputKind, id: number | null) => Promise<void>;
  readonly snapshot: VoiceInputSnapshot;
}): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const select = useEvent(async (kind: VoiceInputKind, id: number | null) => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSelect(kind, id);
    } catch {
      setError(
        "Could not select this microphone. Check that it is still connected and Bluetooth access is allowed.",
      );
    }
    savingRef.current = false;
    setSaving(false);
  });
  const system = useEvent(() => {
    select("system", null).catch(() => undefined);
  });
  const phone = useEvent(() => {
    select("builtin", null).catch(() => undefined);
  });
  const active = !snapshot.active
    ? "No active voice session"
    : snapshot.muted
      ? "Microphone off"
      : snapshot.routedInput === null
        ? "Waiting for Android routing confirmation"
        : `${labels[snapshot.routedInput.kind]} · ${snapshot.routedInput.label}`;
  return (
    <View>
      <Text style={styles.helpText}>Saved preference: {labels[snapshot.preference]}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.helpText}>
        Active input: {active}
      </Text>
      {snapshot.fallback !== "none" && (
        <Text accessibilityLiveRegion="polite" style={styles.helpText}>
          {snapshot.fallback === "unavailable"
            ? "Selected microphone disconnected."
            : "Android did not route the selected microphone."}{" "}
          Using System default. Saved preference is unchanged.
        </Text>
      )}
      <AppListRow
        accessibilityLabel="Use System default microphone"
        disabled={saving}
        onPress={system}
        title="System default"
      />
      <AppListRow
        accessibilityLabel="Use phone microphone"
        disabled={saving}
        onPress={phone}
        title="Phone microphone"
      />
      {snapshot.devices.map((device) =>
        device.kind === "builtin" ? null : (
          <VoiceInputDeviceRow
            device={device}
            disabled={saving}
            key={device.id}
            onSelect={select}
          />
        ),
      )}
      <Text style={styles.helpText}>
        Bluetooth microphone selection also switches the communication output and can reduce
        playback quality. System default preserves Android routing. The previous audio mode is
        restored when Voice Assistant stops.
      </Text>
      {snapshot.bluetoothCoupled && (
        <Text style={styles.helpText}>Bluetooth communication input and output are linked.</Text>
      )}
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
}

function VoiceInputDeviceRow({
  device,
  disabled,
  onSelect,
}: {
  readonly device: VoiceInputDevice;
  readonly disabled: boolean;
  readonly onSelect: (kind: VoiceInputKind, id: number | null) => Promise<void>;
}): React.JSX.Element {
  const select = useEvent(() => {
    onSelect(device.kind, device.id).catch(() => undefined);
  });
  return (
    <AppListRow
      accessibilityLabel={`Use ${labels[device.kind]}: ${device.label}`}
      description={labels[device.kind]}
      disabled={disabled}
      onPress={select}
      title={device.label}
    />
  );
}

/** Binds the settings view to the process-owned native input resource. */
export function ConnectedVoiceInputSettings(): React.JSX.Element {
  const resource = useSelector(globalVoiceAudioInputResource());
  if (resource.status === "loading") {
    return <Text style={styles.helpText}>Reading microphone routes…</Text>;
  }
  if (resource.status === "unavailable") {
    return <Text style={styles.helpText}>{resource.message}</Text>;
  }
  return <VoiceInputSettings onSelect={selectVoiceInput} snapshot={resource.value} />;
}

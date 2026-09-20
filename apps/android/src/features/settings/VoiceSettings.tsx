import { useRef, useState } from "react";
import { View } from "react-native";

import { globalVoiceNames, type GlobalVoiceName } from "../../data/globalVoicePreferences";
import { useEvent } from "../../react/useEvent";
import { iconSize, spacing } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";
import { globalVoiceDescriptions, globalVoiceLabel } from "./globalVoicePresentation";

type VoiceActionState =
  | { readonly status: "idle" }
  | { readonly status: "selecting"; readonly voice: GlobalVoiceName }
  | { readonly status: "previewing"; readonly voice: GlobalVoiceName }
  | { readonly message: string; readonly status: "error" };

const API_KEY_REQUIRED_ERROR = "realtime conversation requires API key auth";

function previewFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === API_KEY_REQUIRED_ERROR) {
    return "Voice samples require OpenAI API key authentication on Companion.";
  }
  return "Could not play this voice sample.";
}

function VoiceOptionRow({
  index,
  onPress,
  onPreview,
  previewing,
  selected,
  voice,
}: {
  readonly index: number;
  readonly onPress: (voice: GlobalVoiceName) => Promise<void>;
  readonly onPreview: (voice: GlobalVoiceName) => Promise<void>;
  readonly previewing: boolean;
  readonly selected: boolean;
  readonly voice: GlobalVoiceName;
}): React.JSX.Element {
  const press = useEvent(() => {
    onPress(voice).catch(() => undefined);
  });
  const preview = useEvent(() => {
    onPreview(voice).catch(() => undefined);
  });
  return (
    <AppListRow
      accessibilityLabel={`Select ${globalVoiceLabel(voice)} voice`}
      description={globalVoiceDescriptions[voice]}
      fixedHeight={listRowHeight.double}
      onPress={press}
      position={listRowPosition(index, globalVoiceNames.length)}
      selected={selected}
      title={globalVoiceLabel(voice)}
      trailingAction={{
        accessibilityLabel: `Play ${globalVoiceLabel(voice)} voice sample`,
        busy: previewing,
        icon: { name: "play-circle-outline", size: iconSize.action },
        onPress: preview,
        visible: selected,
      }}
    />
  );
}

export function VoiceSettings({
  onPreview,
  onSelect,
  selectedVoice,
}: {
  readonly onPreview: (voice: GlobalVoiceName) => Promise<void>;
  readonly onSelect: (voice: GlobalVoiceName) => Promise<void>;
  readonly selectedVoice: GlobalVoiceName;
}): React.JSX.Element {
  const [action, setAction] = useState<VoiceActionState>({ status: "idle" });
  const actionInFlight = useRef(false);
  const activeVoice =
    action.status === "previewing" || action.status === "selecting" ? action.voice : selectedVoice;
  const preview = useEvent(async (voice: GlobalVoiceName) => {
    if (actionInFlight.current) {
      return;
    }
    actionInFlight.current = true;
    setAction({ status: "previewing", voice });
    try {
      await onPreview(voice);
      setAction({ status: "idle" });
    } catch (error) {
      setAction({ message: previewFailureMessage(error), status: "error" });
    }
    actionInFlight.current = false;
  });
  const select = useEvent(async (voice: GlobalVoiceName) => {
    if (actionInFlight.current) {
      return;
    }
    actionInFlight.current = true;
    if (voice !== selectedVoice) {
      setAction({ status: "selecting", voice });
      try {
        await onSelect(voice);
      } catch {
        setAction({ message: "Could not save the voice selection.", status: "error" });
        actionInFlight.current = false;
        return;
      }
    }
    setAction({ status: "previewing", voice });
    try {
      await onPreview(voice);
      setAction({ status: "idle" });
    } catch (error) {
      setAction({ message: previewFailureMessage(error), status: "error" });
    }
    actionInFlight.current = false;
  });

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.helpText}>
        Choose the synthesized voice for new Voice Assistant sessions.
      </Text>
      <View accessibilityRole="radiogroup">
        {globalVoiceNames.map((voice, index) => (
          <VoiceOptionRow
            index={index}
            key={voice}
            onPress={select}
            onPreview={preview}
            previewing={action.status === "previewing" && action.voice === voice}
            selected={voice === activeVoice}
            voice={voice}
          />
        ))}
      </View>
      {action.status === "error" && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {action.message}
        </Text>
      )}
    </View>
  );
}

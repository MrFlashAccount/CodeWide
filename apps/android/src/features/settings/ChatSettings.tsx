import { useSelector } from "@legendapp/state/react";
import { useState, type ReactElement } from "react";
import { View } from "react-native";

import {
  voiceHandoffBehavior$,
  writeVoiceHandoffPreference,
} from "../../data/voiceHandoffPreference";
import type { VoiceHandoffBehavior } from "../../data/voiceHandoffPreferences";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";

const labels: Readonly<Record<VoiceHandoffBehavior, string>> = {
  disable: "Disable",
  send: "Stop and send",
  stop: "Stop and keep draft",
};

/** Owns the persisted cross-chat microphone handoff selection. */
export function ChatSettings(): ReactElement {
  const behavior = useSelector(voiceHandoffBehavior$);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const actions: readonly ActionMenuItem[] = [
    {
      description: "Keep the current recording active",
      id: "disable",
      label: labels.disable,
      selected: behavior === "disable",
    },
    {
      description: "Transcribe into the previous composer",
      id: "stop",
      label: labels.stop,
      selected: behavior === "stop",
    },
    {
      description: "Transcribe and send from the previous chat",
      id: "send",
      label: labels.send,
      selected: behavior === "send",
    },
  ];
  const select = useEvent((id: string) => {
    if (saving || (id !== "disable" && id !== "stop" && id !== "send")) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    void writeVoiceHandoffPreference(id).then(
      () => {
        setSaving(false);
      },
      (error: unknown) => {
        setSaveError(
          error instanceof Error ? error.message : "Could not update microphone handoff",
        );
        setSaving(false);
      },
    );
  });
  return (
    <View testID="voice-handoff-setting">
      <ActionMenu
        accessibilityLabel="Microphone in another chat"
        actions={actions}
        onSelect={select}
      >
        <AppListRow
          accessibilityLabel="Microphone in another chat"
          description={labels[behavior]}
          disabled={saving}
          fixedHeight={listRowHeight.double}
          leadingIcon={{ color: colors.textMuted, name: "mic-outline", size: iconSize.action }}
          title="Microphone in another chat"
          trailingIcon={{
            color: colors.textMuted,
            name: "chevron-down",
            size: iconSize.inline,
          }}
        />
      </ActionMenu>
      {saveError !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {saveError}
        </Text>
      )}
    </View>
  );
}

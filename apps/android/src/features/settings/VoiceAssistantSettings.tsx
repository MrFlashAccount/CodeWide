import { useReducer, useRef, useState } from "react";
import { ActivityIndicator, Switch, View } from "react-native";

import type { GlobalVoiceName } from "../../data/globalVoicePreferences";
import type { GlobalVoiceOrbStyle } from "../../data/globalVoiceOrbStyle";
import {
  normalizeVoiceAssistantPersonality,
  VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH,
  type VoiceAssistantPersonality,
} from "../../data/voiceAssistantPersonality";
import { useEvent } from "../../react/useEvent";
import { AppButton } from "../../presentation/controls/AppButton";
import { colors } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";
import { OrbStyleSettings } from "./OrbStyleSettings";
import { SettingsSection } from "./SettingsSheet";
import { VoiceSettings } from "./VoiceSettings";

type SaveState =
  | { readonly status: "idle" | "saved" }
  | { readonly status: "saving" }
  | { readonly message: string; readonly status: "error" };

type PersonalityEditorState = {
  readonly draft: VoiceAssistantPersonality;
  readonly persisted: VoiceAssistantPersonality;
  readonly save: SaveState;
};

type PersonalityEditorAction =
  | {
      readonly field: keyof VoiceAssistantPersonality;
      readonly type: "edit";
      readonly value: string;
    }
  | { readonly type: "saveStarted" }
  | { readonly personality: VoiceAssistantPersonality; readonly type: "saveSucceeded" }
  | { readonly message: string; readonly type: "saveFailed" };

function initialEditorState(personality: VoiceAssistantPersonality): PersonalityEditorState {
  const normalized = normalizeVoiceAssistantPersonality(personality);
  return { draft: normalized, persisted: normalized, save: { status: "idle" } };
}

function personalityEditorReducer(
  state: PersonalityEditorState,
  action: PersonalityEditorAction,
): PersonalityEditorState {
  switch (action.type) {
    case "edit": {
      const draft = {
        character: action.field === "character" ? action.value : state.draft.character,
        communicationStyle:
          action.field === "communicationStyle" ? action.value : state.draft.communicationStyle,
        rules: action.field === "rules" ? action.value : state.draft.rules,
      };
      return { draft, persisted: state.persisted, save: { status: "idle" } };
    }
    case "saveStarted":
      return { draft: state.draft, persisted: state.persisted, save: { status: "saving" } };
    case "saveSucceeded":
      return {
        draft: action.personality,
        persisted: action.personality,
        save: { status: "saved" },
      };
    case "saveFailed":
      return {
        draft: state.draft,
        persisted: state.persisted,
        save: { message: action.message, status: "error" },
      };
    default:
      return unreachablePersonalityEditorAction(action);
  }
}

function unreachablePersonalityEditorAction(action: never): never {
  throw new Error(`Unhandled Voice Assistant personality action: ${String(action)}`);
}

function samePersonality(
  left: VoiceAssistantPersonality,
  right: VoiceAssistantPersonality,
): boolean {
  return (
    left.character === right.character &&
    left.communicationStyle === right.communicationStyle &&
    left.rules === right.rules
  );
}

function PersonalityField({
  accessibilityLabel,
  label,
  onChangeText,
  placeholder,
  value,
}: {
  readonly accessibilityLabel: string;
  readonly label: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <View style={styles.personalityField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        maxLength={VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH}
        multiline
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        style={styles.personalityInput}
        textAlignVertical="top"
        value={value}
        voiceInput={false}
      />
    </View>
  );
}

function PersonalitySettings({
  onSave,
  personality,
}: {
  readonly onSave: (personality: VoiceAssistantPersonality) => Promise<void>;
  readonly personality: VoiceAssistantPersonality;
}): React.JSX.Element {
  const [editor, dispatch] = useReducer(personalityEditorReducer, personality, initialEditorState);
  const saveInFlight = useRef(false);
  const draft = normalizeVoiceAssistantPersonality(editor.draft);
  const dirty = !samePersonality(draft, editor.persisted);
  const changeCharacter = useEvent((value: string) => {
    dispatch({ field: "character", type: "edit", value });
  });
  const changeCommunicationStyle = useEvent((value: string) => {
    dispatch({ field: "communicationStyle", type: "edit", value });
  });
  const changeRules = useEvent((value: string) => {
    dispatch({ field: "rules", type: "edit", value });
  });
  const save = useEvent(async () => {
    if (!dirty || saveInFlight.current) {
      return;
    }
    saveInFlight.current = true;
    dispatch({ type: "saveStarted" });
    try {
      await onSave(draft);
      dispatch({ personality: draft, type: "saveSucceeded" });
    } catch {
      dispatch({
        message: "Could not save the Voice Assistant personality.",
        type: "saveFailed",
      });
    }
    saveInFlight.current = false;
  });
  const requestSave = useEvent(() => {
    save().catch(() => undefined);
  });
  const saving = editor.save.status === "saving";

  return (
    <View style={styles.personalityForm}>
      <Text style={styles.helpText}>
        Set one persistent character, speaking style and rule set for new Voice Assistant sessions.
      </Text>
      <PersonalityField
        accessibilityLabel="Voice Assistant character"
        label="Character"
        onChangeText={changeCharacter}
        placeholder="For example: calm, candid, curious and pragmatic"
        value={editor.draft.character}
      />
      <PersonalityField
        accessibilityLabel="Voice Assistant communication style"
        label="Communication style"
        onChangeText={changeCommunicationStyle}
        placeholder="For example: concise, warm, ask one question at a time"
        value={editor.draft.communicationStyle}
      />
      <PersonalityField
        accessibilityLabel="Voice Assistant rules"
        label="Rules"
        onChangeText={changeRules}
        placeholder="One rule per line"
        value={editor.draft.rules}
      />
      <AppButton
        accessibilityLabel="Save Voice Assistant personality"
        accessibilityState={{ busy: saving }}
        isDisabled={!dirty || saving}
        onPress={requestSave}
        style={styles.saveButton}
        variant="primary"
      >
        {saving ? "Saving…" : "Save personality"}
      </AppButton>
      {editor.save.status === "saved" && (
        <Text accessibilityLiveRegion="polite" style={styles.savedText}>
          Personality saved. It will apply the next time Voice Assistant starts.
        </Text>
      )}
      {editor.save.status === "error" && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {editor.save.message}
        </Text>
      )}
    </View>
  );
}

type PersonalVoiceFilterSaveState =
  | { readonly status: "idle" | "saved" }
  | { readonly operation: "enroll" | "toggle"; readonly status: "saving" }
  | { readonly message: string; readonly status: "error" };

const PERSONAL_VOICE_FILTER_ICON_SIZE = 20;
const PERSONAL_VOICE_FILTER_ICON = {
  color: colors.textMuted,
  name: "mic",
  size: PERSONAL_VOICE_FILTER_ICON_SIZE,
} as const;

function personalVoiceFilterDescription(hasProfile: boolean): string {
  return hasProfile
    ? "Apply from the next Voice Assistant session"
    : "Record a profile before enabling";
}

function enrollmentAccessibilityLabel(hasProfile: boolean): string {
  return hasProfile ? "Record personal voice profile again" : "Record personal voice profile";
}

function enrollmentButtonLabel(hasProfile: boolean, busy: boolean): string {
  if (busy) {
    return "Listening for 6 seconds…";
  }
  return hasProfile ? "Record profile again" : "Record voice profile";
}

function PersonalVoiceFilterToggle({
  busy,
  enabled,
  hasProfile,
  onValueChange,
}: {
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly hasProfile: boolean;
  readonly onValueChange: (enabled: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.personalVoiceFilterToggle}>
      {busy && <ActivityIndicator color={colors.textMuted} size="small" />}
      <Switch
        accessibilityLabel="Personal voice filter"
        disabled={!hasProfile || busy}
        onValueChange={onValueChange}
        testID="personal-voice-filter-switch"
        value={enabled}
      />
    </View>
  );
}

function PersonalVoiceFilterFeedback({
  save,
}: {
  readonly save: PersonalVoiceFilterSaveState;
}): React.JSX.Element | null {
  if (save.status === "saved") {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.savedText}>
        Voice profile saved locally. Enable the filter to test it.
      </Text>
    );
  }
  if (save.status === "error") {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.errorText}>
        {save.message}
      </Text>
    );
  }
  return null;
}

function PersonalVoiceFilterSettings({
  enabled,
  hasProfile,
  onEnroll,
  onSetEnabled,
}: {
  readonly enabled: boolean;
  readonly hasProfile: boolean;
  readonly onEnroll: () => Promise<void>;
  readonly onSetEnabled: (enabled: boolean) => Promise<void>;
}): React.JSX.Element {
  const [save, setSave] = useState<PersonalVoiceFilterSaveState>({ status: "idle" });
  const pending = save.status === "saving";
  const enrollmentBusy = save.status === "saving" && save.operation === "enroll";
  const toggleBusy = save.status === "saving" && save.operation === "toggle";
  const enroll = useEvent(async () => {
    if (pending) {
      return;
    }
    setSave({ operation: "enroll", status: "saving" });
    try {
      await onEnroll();
      setSave({ status: "saved" });
    } catch (error) {
      setSave({
        message: error instanceof Error ? error.message : "Could not record the voice profile.",
        status: "error",
      });
    }
  });
  const requestEnrollment = useEvent(() => {
    enroll().catch(() => undefined);
  });
  const setEnabled = useEvent(async (nextEnabled: boolean) => {
    if (pending) {
      return;
    }
    setSave({ operation: "toggle", status: "saving" });
    try {
      await onSetEnabled(nextEnabled);
      setSave({ status: "idle" });
    } catch (error) {
      setSave({
        message: error instanceof Error ? error.message : "Could not update the voice filter.",
        status: "error",
      });
    }
  });
  const requestEnabledChange = useEvent((nextEnabled: boolean) => {
    setEnabled(nextEnabled).catch(() => undefined);
  });
  const toggle = (
    <PersonalVoiceFilterToggle
      busy={toggleBusy}
      enabled={enabled}
      hasProfile={hasProfile}
      onValueChange={requestEnabledChange}
    />
  );

  return (
    <View style={styles.personalVoiceFilterSettings}>
      <Text style={styles.helpText}>
        Experimental. Opens new local voice segments optimistically and checks a short rolling
        spectral match. Continuous rejected audio stays closed until your profile matches. A
        rejected voice can send a brief prefix. Stop Voice Assistant before recording a profile.
      </Text>
      <AppListRow
        description={personalVoiceFilterDescription(hasProfile)}
        fixedHeight={listRowHeight.double}
        leadingIcon={PERSONAL_VOICE_FILTER_ICON}
        title="Personal voice filter"
        // WHY: AppListRow's declared custom accessory contract requires this independently interactive Switch as a ReactNode prop.
        // oxlint-disable-next-line react-doctor/jsx-no-jsx-as-prop
        trailing={toggle}
      />
      <AppButton
        accessibilityLabel={enrollmentAccessibilityLabel(hasProfile)}
        accessibilityState={{ busy: enrollmentBusy }}
        isDisabled={pending}
        onPress={requestEnrollment}
        style={styles.saveButton}
        variant="secondary"
      >
        {enrollmentButtonLabel(hasProfile, enrollmentBusy)}
      </AppButton>
      <PersonalVoiceFilterFeedback save={save} />
    </View>
  );
}

/** Keeps synthesized voice, behavioral personality, and visual style visibly separate. */
export function VoiceAssistantSettings({
  onEnrollPersonalVoice,
  onPreviewVoice,
  onSavePersonality,
  onSelectOrbStyle,
  onSelectVoice,
  onSetPersonalVoiceFilterEnabled,
  personality,
  personalVoiceFilterEnabled,
  personalVoiceProfileAvailable,
  selectedOrbStyle,
  selectedVoice,
}: {
  readonly onEnrollPersonalVoice: () => Promise<void>;
  readonly onPreviewVoice: (voice: GlobalVoiceName) => Promise<void>;
  readonly onSavePersonality: (personality: VoiceAssistantPersonality) => Promise<void>;
  readonly onSelectOrbStyle: (style: GlobalVoiceOrbStyle) => Promise<void>;
  readonly onSelectVoice: (voice: GlobalVoiceName) => Promise<void>;
  readonly onSetPersonalVoiceFilterEnabled: (enabled: boolean) => Promise<void>;
  readonly personality: VoiceAssistantPersonality;
  readonly personalVoiceFilterEnabled: boolean;
  readonly personalVoiceProfileAvailable: boolean;
  readonly selectedOrbStyle: GlobalVoiceOrbStyle;
  readonly selectedVoice: GlobalVoiceName;
}): React.JSX.Element {
  return (
    <View style={styles.voiceAssistantSettings}>
      <SettingsSection title="Voice">
        <VoiceSettings
          onPreview={onPreviewVoice}
          onSelect={onSelectVoice}
          selectedVoice={selectedVoice}
        />
      </SettingsSection>
      <SettingsSection title="Orb style">
        <OrbStyleSettings onSelect={onSelectOrbStyle} selectedStyle={selectedOrbStyle} />
      </SettingsSection>
      <SettingsSection title="Personality">
        <PersonalitySettings onSave={onSavePersonality} personality={personality} />
      </SettingsSection>
      <SettingsSection title="Microphone filtering">
        <PersonalVoiceFilterSettings
          enabled={personalVoiceFilterEnabled}
          hasProfile={personalVoiceProfileAvailable}
          onEnroll={onEnrollPersonalVoice}
          onSetEnabled={onSetPersonalVoiceFilterEnabled}
        />
      </SettingsSection>
    </View>
  );
}

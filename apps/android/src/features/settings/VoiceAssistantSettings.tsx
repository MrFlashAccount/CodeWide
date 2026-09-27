import { Ionicons } from "@expo/vector-icons";
import { useReducer, useRef, useState } from "react";
import { ActivityIndicator, Switch, View } from "react-native";

import type { GlobalVoiceName } from "../../data/globalVoicePreferences";
import type { GlobalVoiceOrbStyle } from "../../data/globalVoiceOrbStyle";
import type { VoiceAssistantModelCatalogSnapshot } from "../../data/voiceAssistantModelCatalog";
import {
  normalizeVoiceAssistantPersonality,
  VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH,
  type VoiceAssistantPersonality,
} from "../../data/voiceAssistantPersonality";
import { useEvent } from "../../react/useEvent";
import { AppButton } from "../../presentation/controls/AppButton";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { modelEffortLabel } from "../../ui/modelEffortPresentation";
import { ModelThinkingMenu } from "../../ui/TurnControlMenus";
import type { ModelSettingsChoice } from "../../ui/TurnControlMenus.types";
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
  | { readonly type: "edit"; readonly value: string }
  | { readonly type: "saveStarted" }
  | { readonly personality: VoiceAssistantPersonality; readonly type: "saveSucceeded" }
  | { readonly message: string; readonly type: "saveFailed" };

function initialEditorState(personality: VoiceAssistantPersonality): PersonalityEditorState {
  const normalized = normalizeVoiceAssistantPersonality(personality);
  return {
    draft: { character: normalized.character, communicationStyle: "", rules: "" },
    persisted: normalized,
    save: { status: "idle" },
  };
}

function personalityEditorReducer(
  state: PersonalityEditorState,
  action: PersonalityEditorAction,
): PersonalityEditorState {
  switch (action.type) {
    case "edit": {
      const draft = {
        character: action.value,
        communicationStyle: "",
        rules: "",
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
  onChangeText,
  placeholder,
  value,
}: {
  readonly accessibilityLabel: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}): React.JSX.Element {
  return (
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
    dispatch({ type: "edit", value });
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
        Set the persistent personality for new Voice Assistant sessions.
      </Text>
      <PersonalityField
        accessibilityLabel="Voice Assistant personality"
        onChangeText={changeCharacter}
        placeholder="For example: calm, candid, curious and pragmatic"
        value={editor.draft.character}
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

function AgentModelSetting({
  catalog,
  onRefresh,
  onSelect,
  selectedEffort,
  selectedModel,
}: {
  readonly catalog: VoiceAssistantModelCatalogSnapshot;
  readonly onRefresh: () => Promise<void>;
  readonly onSelect: (settings: {
    readonly effort: string;
    readonly model: string;
  }) => Promise<void>;
  readonly selectedEffort: string | null;
  readonly selectedModel: string | null;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const refresh = useEvent(() => {
    setError(null);
    onRefresh().catch(() => undefined);
  });
  const close = useEvent(() => undefined);
  const select = useEvent((choice: ModelSettingsChoice) => {
    setError(null);
    onSelect({ effort: choice.effort, model: choice.model }).catch((selectionError: unknown) => {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "Could not save the agent model.",
      );
    });
  });
  const model = catalog.models.find((candidate) => candidate.id === selectedModel);
  const modelLabel = model?.label ?? selectedModel ?? "Choose model";
  const value =
    selectedEffort === null ? modelLabel : `${modelLabel} · ${modelEffortLabel(selectedEffort)}`;
  const catalogError = catalog.status === "error" ? catalog.error : null;

  return (
    <View style={styles.personalityForm}>
      <ModelThinkingMenu
        accessibilityLabel={`Agent model: ${value}`}
        error={catalogError}
        loading={catalog.status === "idle" || catalog.status === "loading"}
        models={catalog.models}
        onApplySettings={select}
        onClose={close}
        onFallbackPress={refresh}
        onOpen={refresh}
        selectedEffort={selectedEffort}
        selectedModel={selectedModel}
        selectedPersonality={null}
        selectedServiceTier={null}
        showPersonalityControls={false}
        showServiceTierControls={false}
        triggerChildren={<AgentModelTrigger value={value} />}
        triggerStyle={styles.agentModelRow}
      />
      {error !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
}

function AgentModelTrigger({ value }: { readonly value: string }): React.JSX.Element {
  return (
    <>
      <Text style={styles.agentModelTitle}>Agent model</Text>
      <AgentModelValue value={value} />
    </>
  );
}

function AgentModelValue({ value }: { readonly value: string }): React.JSX.Element {
  return (
    <View style={styles.agentModelValueGroup}>
      <Text numberOfLines={1} style={styles.agentModelValue}>
        {value}
      </Text>
      <Ionicons color={colors.textMuted} name="chevron-down" size={iconSize.inline} />
    </View>
  );
}

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
  backgroundModelCatalog,
  onEnrollPersonalVoice,
  onPreviewVoice,
  onRefreshBackgroundModels,
  onSavePersonality,
  onSelectBackgroundModel,
  onSelectOrbStyle,
  onSelectVoice,
  onSetPersonalVoiceFilterEnabled,
  personality,
  personalVoiceFilterEnabled,
  personalVoiceProfileAvailable,
  selectedBackgroundEffort,
  selectedBackgroundModel,
  selectedOrbStyle,
  selectedVoice,
}: {
  readonly backgroundModelCatalog: VoiceAssistantModelCatalogSnapshot;
  readonly onEnrollPersonalVoice: () => Promise<void>;
  readonly onPreviewVoice: (voice: GlobalVoiceName) => Promise<void>;
  readonly onRefreshBackgroundModels: () => Promise<void>;
  readonly onSavePersonality: (personality: VoiceAssistantPersonality) => Promise<void>;
  readonly onSelectBackgroundModel: (settings: {
    readonly effort: string;
    readonly model: string;
  }) => Promise<void>;
  readonly onSelectOrbStyle: (style: GlobalVoiceOrbStyle) => Promise<void>;
  readonly onSelectVoice: (voice: GlobalVoiceName) => Promise<void>;
  readonly onSetPersonalVoiceFilterEnabled: (enabled: boolean) => Promise<void>;
  readonly personality: VoiceAssistantPersonality;
  readonly personalVoiceFilterEnabled: boolean;
  readonly personalVoiceProfileAvailable: boolean;
  readonly selectedBackgroundEffort: string | null;
  readonly selectedBackgroundModel: string | null;
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
      <AgentModelSetting
        catalog={backgroundModelCatalog}
        onRefresh={onRefreshBackgroundModels}
        onSelect={onSelectBackgroundModel}
        selectedEffort={selectedBackgroundEffort}
        selectedModel={selectedBackgroundModel}
      />
      <SettingsSection title="Personality">
        <PersonalitySettings onSave={onSavePersonality} personality={personality} />
      </SettingsSection>
      <SettingsSection title="Microphone filtering (Experimental)">
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

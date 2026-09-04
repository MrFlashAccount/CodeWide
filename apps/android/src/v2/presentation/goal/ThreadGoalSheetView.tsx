import { useState } from "react";
import { View } from "react-native";
import type { V2ThreadGoal } from "@codewide/sync-client/v2";

import { useEvent } from "../../../react/useEvent";
import { colors } from "../../theme";
import { PresentationSheetView } from "../surfaces/PresentationSheetView";
import { PresentationTextInput, ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { VoiceTextInputView, type VoiceTextInputControl } from "../input/VoiceTextInputView";
import { threadGoalSheetStyles as styles } from "./threadGoalSheetStyles";
import { ThreadGoalSheetHeader } from "./ThreadGoalSheetHeader";
import { ThreadGoalAdvancedFields } from "./ThreadGoalAdvancedFields";
import { ThreadGoalActions } from "./ThreadGoalActions";
import { ThreadGoalDetails } from "./threadGoalDetails";

interface ThreadGoalSheetViewProps {
  error: string | null;
  goal: V2ThreadGoal | null;
  loading: boolean;
  objective: string;
  onClear(): Promise<void>;
  onClose(): void;
  onObjectiveChange(value: string): void;
  onSave(): Promise<void>;
  onTokenBudgetChange(value: string): void;
  tokenBudget: string;
  voice?: ThreadGoalVoiceModel;
}

interface ThreadGoalVoiceModel extends VoiceTextInputControl {
  message: string | null;
}

/** Goal editor state is UI-only; the authoritative value always enters through `goal`. */
export function ThreadGoalSheetView(props: ThreadGoalSheetViewProps): React.JSX.Element {
  const {
    error: resourceError,
    goal,
    loading,
    objective,
    onClear,
    onClose,
    onObjectiveChange,
    onSave,
    onTokenBudgetChange,
    tokenBudget,
    voice,
  } = props;
  const voiceActive =
    voice !== undefined &&
    (voice.state === "starting" ||
      voice.state === "recording" ||
      voice.state === "finishing" ||
      voice.state === "retry");
  const blocked = loading || resourceError !== null || voiceActive;
  const [pending, setPending] = useState<"clear" | "save" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const close = useEvent(() => {
    if (pending === null) onClose();
  });
  const handleOpenChange = useEvent((isOpen: boolean) => {
    if (!isOpen) close();
  });
  const save = useEvent((): void => {
    if (pending !== null) return;
    const normalized = objective.trim();
    if (normalized === "") {
      setActionError("Goal objective is required");
      return;
    }
    setPending("save");
    setActionError(null);
    void onSave().then(
      () => {
        setPending(null);
        onClose();
      },
      (cause: unknown) => {
        setActionError(actionFailure(cause, "Could not save goal"));
        setPending(null);
      },
    );
  });
  const clear = useEvent((): void => {
    if (pending !== null) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setPending("clear");
    setActionError(null);
    void onClear().then(
      () => {
        setPending(null);
        onClose();
      },
      (cause: unknown) => {
        setActionError(actionFailure(cause, "Could not clear goal"));
        setPending(null);
      },
    );
  });
  const changeObjective = useEvent((value: string) => {
    onObjectiveChange(value);
    setActionError(null);
  });
  const visibleError =
    actionError ??
    resourceError ??
    (voice?.state === "error" || voice?.state === "retry" ? voice.message : null);

  return (
    <PresentationSheetView
      contentProps={{ enableDynamicSizing: true, index: 0 }}
      isOpen
      onOpenChange={handleOpenChange}
    >
      <ThreadGoalSheetHeader disabled={pending !== null} goal={goal} onClose={close} />
      <View style={styles.content}>
        {loading ? <ShimmerText text="Loading goal…" /> : null}
        {goal === null ? null : <ThreadGoalDetails goal={goal} />}
        <ProductText style={styles.label} weight="medium">
          What should Codex work toward?
        </ProductText>
        {voice === undefined ? (
          <PresentationTextInput
            accessibilityLabel="Goal objective"
            editable={!loading && resourceError === null && pending === null}
            multiline
            onChangeText={changeObjective}
            placeholder="Describe the outcome…"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={objective}
          />
        ) : (
          <VoiceTextInputView
            accessibilityLabel="Goal objective"
            editable={!loading && resourceError === null && pending === null}
            multiline
            onChangeText={changeObjective}
            placeholder="Describe the outcome…"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={objective}
            voice={voice}
          />
        )}
        <ThreadGoalAdvancedFields
          disabled={blocked || pending !== null}
          onChange={onTokenBudgetChange}
          value={tokenBudget}
        />
        {visibleError === null ? null : (
          <ProductText accessibilityLiveRegion="polite" tone="danger">
            {visibleError}
          </ProductText>
        )}
        {confirmClear ? (
          <ProductText tone="warning">Remove this goal from the thread?</ProductText>
        ) : null}
        <ThreadGoalActions
          confirmClear={confirmClear}
          disabled={blocked}
          hasGoal={goal !== null}
          onClear={clear}
          onClose={close}
          onSave={save}
          pending={pending}
        />
      </View>
    </PresentationSheetView>
  );
}

function actionFailure(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}

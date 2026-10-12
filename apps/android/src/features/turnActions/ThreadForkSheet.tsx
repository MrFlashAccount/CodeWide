/** The "Fork" sheet: the thread's current model preselected, another model optional. */
import { useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import type { ThreadForkOptions, ThreadForkTarget } from "../../data/thread-fork";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import { AppSheet } from "../../ui/AppSheet";
import { ModelChoiceList, ModelDisclosure } from "../../ui/ModelChoiceList";
import { providerDisplayName } from "../../ui/providerBrand";
import { AppText as Text } from "../../ui/Typography";
import type { ForkRequest, ForkTargetPicker } from "./forkTargetPicker";
import {
  forkModelsSpanProviders,
  forkSelection,
  type ForkModel,
  type ForkOffer,
  type ForkSelection,
} from "./forkTargets";
import { styles } from "./ThreadActions.styles";

/** Renders the conversation's open "Fork" sheet; confirming it forks through `onFork`. */
export function ThreadForkSheet({
  onFork,
  picker,
}: {
  readonly onFork: (options: ThreadForkOptions) => Promise<void>;
  readonly picker: ForkTargetPicker;
}): ReactElement | null {
  const dialog = useAppDialog();
  const request = picker.request;
  const confirm = useEvent((target: ThreadForkTarget | null) => {
    if (request === null) {
      return;
    }
    picker.closeFork();
    void onFork({ boundary: request.boundary, ephemeral: false, target }).catch(
      (error: unknown) => {
        dialog.alert(
          "Fork failed",
          error instanceof Error ? error.message : "Thread action failed",
        );
      },
    );
  });
  if (request === null) {
    return null;
  }
  return (
    <ForkSheetContent
      key={
        request.boundary.kind === "all"
          ? "all"
          : `${request.boundary.kind}:${request.boundary.turnId}`
      }
      onClose={picker.closeFork}
      onConfirm={confirm}
      request={request}
    />
  );
}

function ForkSheetContent({
  onClose,
  onConfirm,
  request,
}: {
  readonly onClose: () => void;
  readonly onConfirm: (target: ThreadForkTarget | null) => void;
  readonly request: ForkRequest;
}): ReactElement {
  const offer = request.offer;
  // Without its own fork the agent has no current model to keep: the user picks one first.
  const [selection, setSelection] = useState<ForkSelection | null>(offer.current);
  const [expanded, setExpanded] = useState(offer.current === null);
  const toggleModels = useEvent(() => {
    setExpanded((current) => !current);
  });
  const chooseModel = useEvent((model: ForkModel) => {
    setSelection(forkSelection(offer, model));
    setExpanded(false);
  });
  const fork = useEvent(() => {
    if (selection !== null) {
      onConfirm(selection.target);
    }
  });
  return (
    <AppSheet
      contentProps={{ enableDynamicSizing: true, index: 0 }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <View style={styles.forkSheet} testID="fork-sheet">
        <Text style={styles.sheetTitle}>Fork</Text>
        <ForkModelPicker
          expanded={expanded}
          offer={offer}
          onChoose={chooseModel}
          onToggle={toggleModels}
          selection={selection}
        />
        {selection?.handoff === true && selection.provider !== null && (
          <Text style={styles.forkHandoffNote} testID="fork-handoff-note">
            {`${providerDisplayName(selection.provider)} can't continue this chat as is: the new chat starts from a summary of this conversation.`}
          </Text>
        )}
        <ForkButton disabled={selection === null} onPress={fork} />
      </View>
    </AppSheet>
  );
}

/** The fork's model: the composer's model rows, expandable when other models are offered. */
function ForkModelPicker({
  expanded,
  offer,
  onChoose,
  onToggle,
  selection,
}: {
  readonly expanded: boolean;
  readonly offer: ForkOffer;
  readonly onChoose: (model: ForkModel) => void;
  readonly onToggle: () => void;
  readonly selection: ForkSelection | null;
}): ReactElement {
  if (offer.models.length === 0) {
    return offer.current === null ? (
      <Text style={styles.sheetEmpty}>No model is available for this fork.</Text>
    ) : (
      <ForkModelDisclosure expanded={false} onToggle={null} selection={selection} />
    );
  }
  return (
    <>
      <ForkModelDisclosure expanded={expanded} onToggle={onToggle} selection={selection} />
      {expanded && (
        <ModelChoiceList
          grouped={forkModelsSpanProviders(offer)}
          models={offer.models}
          onChoose={onChoose}
          selectedModel={selection?.model ?? null}
        />
      )}
    </>
  );
}

function ForkModelDisclosure({
  expanded,
  onToggle,
  selection,
}: {
  readonly expanded: boolean;
  readonly onToggle: (() => void) | null;
  readonly selection: ForkSelection | null;
}): ReactElement {
  return (
    <View style={styles.forkModelRow}>
      <ModelDisclosure
        expanded={expanded}
        label={selection === null ? null : (selection.label ?? "Current model")}
        onPress={onToggle}
        provider={selection?.provider ?? null}
      />
    </View>
  );
}

function ForkButton({
  disabled,
  onPress,
}: {
  readonly disabled: boolean;
  readonly onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      accessibilityLabel="Fork"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.forkButton, disabled && styles.forkButtonDisabled]}
    >
      <Text style={styles.forkButtonText}>Fork</Text>
    </Pressable>
  );
}

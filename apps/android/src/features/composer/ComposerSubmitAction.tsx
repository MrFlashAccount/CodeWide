import { colors } from "../../theme";
import { SwipeDiscardAction } from "../../ui/SwipeDiscardAction";
import { ComposerDeliveryMenu } from "./ComposerDeliveryMenu";
import type { ComposerFeatureProps } from "./ComposerFeatureContract";
import { styles } from "./ComposerSubmitAction.styles";

type Props = Pick<
  ComposerFeatureProps,
  | "editingQueuedMessage"
  | "sendDisabled"
  | "composerDiscardEnabled"
  | "queuedComposerEditBusy"
  | "discardComposer"
  | "steerComposer"
  | "activatePrimaryAction"
  | "deliveryActions"
  | "dismissComposerKeyboardForOverlay"
  | "handleDeliveryAction"
  | "voicePhase"
  | "stoppingResponse"
  | "threadLifecycleActive"
  | "currentTurnId"
>;
export function ComposerSubmitAction({
  activatePrimaryAction,
  composerDiscardEnabled,
  currentTurnId,
  deliveryActions,
  discardComposer,
  dismissComposerKeyboardForOverlay,
  editingQueuedMessage,
  handleDeliveryAction,
  queuedComposerEditBusy,
  sendDisabled,
  steerComposer,
  stoppingResponse,
  threadLifecycleActive,
  voicePhase,
}: Props) {
  return editingQueuedMessage ? (
    <SwipeDiscardAction
      accessibilityLabel="Save queued message"
      disabled={sendDisabled}
      disabledStyle={styles.disabled}
      discardEnabled={composerDiscardEnabled}
      icon={queuedComposerEditBusy ? "hourglass-outline" : "checkmark"}
      iconColor={colors.onPrimary}
      onDiscard={discardComposer}
      onPress={activatePrimaryAction}
      onSteer={steerComposer}
      pressedStyle={styles.sendButtonPressed}
      steerEnabled={false}
      style={styles.sendButton}
    />
  ) : (
    <ComposerDeliveryMenu
      actions={deliveryActions}
      onOpen={dismissComposerKeyboardForOverlay}
      onSelect={handleDeliveryAction}
    >
      <SwipeDiscardAction
        accessibilityLabel={
          voicePhase !== "idle"
            ? "Finish voice input and send transcript"
            : stoppingResponse
              ? "Stop response"
              : "Send message"
        }
        disabled={sendDisabled}
        disabledStyle={styles.disabled}
        discardEnabled={composerDiscardEnabled}
        icon={
          voicePhase === "finishing" ? "hourglass-outline" : stoppingResponse ? "stop" : "arrow-up"
        }
        iconColor={stoppingResponse ? "#ffffff" : colors.onPrimary}
        onDiscard={discardComposer}
        onPress={activatePrimaryAction}
        onSteer={steerComposer}
        pressedStyle={stoppingResponse ? undefined : styles.sendButtonPressed}
        steerEnabled={!sendDisabled && threadLifecycleActive && currentTurnId !== null}
        style={[styles.sendButton, stoppingResponse && styles.stopButton]}
      />
    </ComposerDeliveryMenu>
  );
}

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
  editingQueuedMessage,
  sendDisabled,
  composerDiscardEnabled,
  queuedComposerEditBusy,
  discardComposer,
  steerComposer,
  activatePrimaryAction,
  deliveryActions,
  dismissComposerKeyboardForOverlay,
  handleDeliveryAction,
  voicePhase,
  stoppingResponse,
  threadLifecycleActive,
  currentTurnId,
}: Props) {
  return editingQueuedMessage ? (
    <SwipeDiscardAction
      accessibilityLabel="Save queued message"
      disabled={sendDisabled}
      discardEnabled={composerDiscardEnabled}
      steerEnabled={false}
      icon={queuedComposerEditBusy ? "hourglass-outline" : "checkmark"}
      iconColor={colors.onPrimary}
      style={styles.sendButton}
      pressedStyle={styles.sendButtonPressed}
      disabledStyle={styles.disabled}
      onDiscard={discardComposer}
      onSteer={steerComposer}
      onPress={activatePrimaryAction}
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
        discardEnabled={composerDiscardEnabled}
        steerEnabled={!sendDisabled && threadLifecycleActive && currentTurnId !== null}
        icon={
          voicePhase === "finishing" ? "hourglass-outline" : stoppingResponse ? "stop" : "arrow-up"
        }
        iconColor={stoppingResponse ? "#ffffff" : colors.onPrimary}
        style={[styles.sendButton, stoppingResponse && styles.stopButton]}
        pressedStyle={stoppingResponse ? undefined : styles.sendButtonPressed}
        disabledStyle={styles.disabled}
        onDiscard={discardComposer}
        onSteer={steerComposer}
        onPress={activatePrimaryAction}
      />
    </ComposerDeliveryMenu>
  );
}

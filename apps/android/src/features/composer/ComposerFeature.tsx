import { Ionicons } from "@expo/vector-icons";
import type { ReactElement } from "react";
import { Pressable, View } from "react-native";
import { ComposerAttachmentTray } from "../../rendering/ComposerAttachmentTray";
import { colors, controlHitSlop, iconSize } from "../../theme";
import { ActionMenu } from "../../ui/ActionMenu";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { ComposerAccessoryTray } from "./ComposerAccessoryTray";
import { ComposerContextStrip } from "./ComposerContextStrip";
import { ComposerEditor } from "./ComposerEditor";
import { styles } from "./ComposerFeature.styles";
import type { ComposerFeatureProps } from "./ComposerFeatureContract";
import { ComposerMicrophone } from "./ComposerMicrophone";
import { ComposerSubmitAction } from "./ComposerSubmitAction";
import { ComposerGoalAttachment } from "../goal/ComposerGoalAttachment";

/** Composes the V1 message editor, context controls, and submission actions. */
export function ComposerFeature(props: ComposerFeatureProps) {
  return (
    <View style={styles.composerDock} testID="composer-dock">
      <ComposerContextStrip
        applyModelSettings={props.applyModelSettings}
        closeQuickControlMenu={props.closeQuickControlMenu}
        controlError={props.controlError}
        controlsResourceId={props.controlsResourceId}
        cwd={props.cwd}
        newChat={props.newChat}
        onLoadControls={props.onLoadControls}
        openControls={props.openControls}
        openQuickControlMenu={props.openQuickControlMenu}
        readOnly={props.readOnly}
        remoteThread={props.remoteThread}
        selectedEffort={props.selectedEffort}
        selectedModel={props.selectedModel}
        selectedPermissions={props.selectedPermissions}
        selectedPersonality={props.selectedPersonality}
        selectedServiceTier={props.selectedServiceTier}
        selectPermissions={props.selectPermissions}
        toolContextChips={props.toolContextChips}
        workspaceResources={props.workspaceResources}
      />
      {!props.readOnly && (
        <>
          {props.queuedComposerEdit !== null && (
            <View style={styles.queuedComposerEditBar} testID="queued-composer-edit-bar">
              <InlineIcon color={colors.accent} name="create-outline" role="label" />
              <Text numberOfLines={1} style={styles.queuedComposerEditTitle}>
                Editing queue
              </Text>
              <Text numberOfLines={1} style={styles.queuedComposerEditPreview}>
                {props.draft}
              </Text>
              <Pressable
                accessibilityLabel="Cancel queued message edit"
                accessibilityRole="button"
                hitSlop={controlHitSlop.regular}
                onPress={props.cancelQueuedComposerEdit}
                style={styles.queuedComposerEditClose}
              >
                <InlineIcon color={colors.textMuted} name="close" role="label" />
              </Pressable>
            </View>
          )}
          {props.queuedComposerEditError !== null && (
            <View style={styles.composerErrorRow}>
              <Text style={styles.composerError}>{props.queuedComposerEditError}</Text>
            </View>
          )}
          {(props.getTransferAccess !== undefined ||
            (props.goalAttachmentVisible && props.onSetGoal !== undefined)) && (
            <ComposerAttachmentTray
              attachments={props.attachments}
              getAccess={props.getStableTransferAccess}
              onRemove={props.removeComposerAttachment}
              scope={props.composerUploadScope}
              {...(props.goalAttachmentVisible && props.onSetGoal !== undefined
                ? {
                    startAttachment: <ComposerGoalAttachment onClose={props.closeGoalAttachment} />,
                  }
                : {})}
            />
          )}
          {props.composerTrayVisible && !props.useAnchoredComposerMenu && (
            <ComposerAccessoryTray
              fileEnabled={props.fileAttachmentEnabled}
              goalEnabled={props.onSetGoal !== undefined}
              onSelect={props.openAccessoryAction}
              terminalEnabled={props.terminalEnabled}
            />
          )}
          <View style={styles.composer} testID="composer-row">
            <View style={styles.composerInputShell} testID="composer-input-shell">
              {props.useAnchoredComposerMenu ? (
                <ActionMenu
                  accessibilityLabel="Composer menu"
                  actions={props.anchoredComposerActions}
                  align="start"
                  onOpenChange={(open) => {
                    if (open) {
                      props.dismissComposerKeyboardForOverlay();
                    }
                  }}
                  onSelect={props.handleAnchoredComposerAction}
                  placement="top"
                  style={styles.composerMenuAnchor}
                >
                  <Pressable accessibilityLabel="Composer menu" style={styles.composerMenu}>
                    <Ionicons color={colors.text} name="add" size={iconSize.navigation} />
                  </Pressable>
                </ActionMenu>
              ) : (
                <Pressable
                  accessibilityLabel={
                    props.composerTrayVisible ? "Close composer menu" : "Composer menu"
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: props.composerTrayVisible }}
                  onPress={() => {
                    props.setComposerTrayVisible((current) => !current);
                  }}
                  style={({ pressed }) => [
                    styles.composerMenu,
                    props.composerTrayVisible && styles.composerMenuActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    color={colors.text}
                    name={props.composerTrayVisible ? "close" : "add"}
                    size={iconSize.navigation}
                  />
                </Pressable>
              )}
              <ComposerEditor
                attachments={props.attachments}
                composerInputRef={props.composerInputRef}
                composerScope={props.composerScope}
                draft={props.draft}
                draftSelectionRef={props.draftSelectionRef}
                editingQueuedMessage={props.editingQueuedMessage}
                fileAttachmentEnabled={props.fileAttachmentEnabled}
                getStableTransferAccess={props.getStableTransferAccess}
                getTransferAccess={props.getTransferAccess}
                handleComposerLargePaste={props.handleComposerLargePaste}
                handleComposerTextChange={props.handleComposerTextChange}
                pastedAttachmentPending={props.pastedAttachmentPending}
                pendingVoiceSelection={props.pendingVoiceSelection}
                searchComposerSuggestions={props.searchComposerSuggestions}
                selectComposerMention={props.selectComposerMention}
                voiceBackend={props.voiceBackend}
                voiceController={props.voiceController}
                voicePhase={props.voicePhase}
                voiceResource={props.voiceResource}
              />
              <ComposerMicrophone
                editingQueuedMessage={props.editingQueuedMessage}
                finishVoice={props.finishVoice}
                microphoneAccess={props.microphoneAccess}
                microphoneButtonRef={props.microphoneButtonRef}
                retryVoice={props.retryVoice}
                toggleVoice={props.toggleVoice}
                voicePhase={props.voicePhase}
                voiceRetryAvailable={props.voiceRetryAvailable}
              />
              <ComposerSubmitAction
                activatePrimaryAction={props.activatePrimaryAction}
                composerDiscardEnabled={props.composerDiscardEnabled}
                currentTurnId={props.currentTurnId}
                deliveryActions={props.deliveryActions}
                discardComposer={props.discardComposer}
                dismissComposerKeyboardForOverlay={props.dismissComposerKeyboardForOverlay}
                editingQueuedMessage={props.editingQueuedMessage}
                goalAttachmentVisible={props.goalAttachmentVisible}
                handleDeliveryAction={props.handleDeliveryAction}
                queuedComposerEditBusy={props.queuedComposerEditBusy}
                sendDisabled={props.sendDisabled}
                steerComposer={props.steerComposer}
                stoppingResponse={props.stoppingResponse}
                threadLifecycleActive={props.threadLifecycleActive}
                voicePhase={props.voicePhase}
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

/** Reserves the resting composer geometry while its persisted draft is restored. */
export function ComposerLoadingPlaceholder(): ReactElement {
  return (
    <View style={styles.composerDock} testID="composer-loading-placeholder">
      <View style={styles.composer}>
        <View style={styles.composerInputShell} />
      </View>
    </View>
  );
}

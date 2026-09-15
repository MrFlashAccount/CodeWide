import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, View } from "react-native";
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
export function ComposerFeature(props: ComposerFeatureProps) {
  return (
    <View testID="composer-dock" style={styles.composerDock}>
      <ComposerContextStrip
        newChat={props.newChat}
        workspaceResources={props.workspaceResources}
        controlsResourceId={props.controlsResourceId}
        cwd={props.cwd}
        remoteThread={props.remoteThread}
        readOnly={props.readOnly}
        selectedModel={props.selectedModel}
        selectedEffort={props.selectedEffort}
        selectedPersonality={props.selectedPersonality}
        selectedPermissions={props.selectedPermissions}
        controlError={props.controlError}
        onLoadControls={props.onLoadControls}
        openQuickControlMenu={props.openQuickControlMenu}
        closeQuickControlMenu={props.closeQuickControlMenu}
        openControls={props.openControls}
        selectModel={props.selectModel}
        selectEffort={props.selectEffort}
        setSelectedPersonality={props.setSelectedPersonality}
        selectPermissions={props.selectPermissions}
        toolContextChips={props.toolContextChips}
      />
      {!props.readOnly && (
        <>
          {props.queuedComposerEdit !== null && (
            <View testID="queued-composer-edit-bar" style={styles.queuedComposerEditBar}>
              <InlineIcon name="create-outline" role="label" color={colors.accent} />
              <Text numberOfLines={1} style={styles.queuedComposerEditTitle}>
                Editing queue
              </Text>
              <Text numberOfLines={1} style={styles.queuedComposerEditPreview}>
                {props.queuedComposerEdit.text}
              </Text>
              <Pressable
                accessibilityLabel="Cancel queued message edit"
                accessibilityRole="button"
                hitSlop={controlHitSlop.regular}
                onPress={props.cancelQueuedComposerEdit}
                style={styles.queuedComposerEditClose}
              >
                <InlineIcon name="close" role="label" color={colors.textMuted} />
              </Pressable>
            </View>
          )}
          {(props.voiceError !== null || props.queuedComposerEditError !== null) && (
            <View style={styles.composerErrorRow}>
              <Text style={styles.composerError}>
                {props.queuedComposerEditError ?? props.voiceError}
              </Text>
            </View>
          )}
          {props.getTransferAccess !== undefined && (
            <ComposerAttachmentTray
              scope={props.composerUploadScope}
              attachments={props.attachments}
              getAccess={props.getStableTransferAccess}
              onRemove={props.removeComposerAttachment}
            />
          )}
          {props.composerTrayVisible && !props.useAnchoredComposerMenu && (
            <ComposerAccessoryTray
              fileEnabled={props.fileAttachmentEnabled}
              terminalEnabled={
                Platform.OS === "android" &&
                props.draftConnectionId !== null &&
                props.draftThreadId !== null
              }
              portForwardEnabled={props.portForwardingConnectionId !== null}
              onSelect={props.openAccessoryAction}
            />
          )}
          <View testID="composer-row" style={styles.composer}>
            <View testID="composer-input-shell" style={styles.composerInputShell}>
              {props.useAnchoredComposerMenu ? (
                <ActionMenu
                  accessibilityLabel="Composer menu"
                  actions={props.anchoredComposerActions}
                  placement="top"
                  align="start"
                  onOpenChange={(open) => {
                    if (open) props.dismissComposerKeyboardForOverlay();
                  }}
                  onSelect={props.handleAnchoredComposerAction}
                  style={styles.composerMenuAnchor}
                >
                  <Pressable accessibilityLabel="Composer menu" style={styles.composerMenu}>
                    <Ionicons name="add" size={iconSize.navigation} color={colors.text} />
                  </Pressable>
                </ActionMenu>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    props.composerTrayVisible ? "Close composer menu" : "Composer menu"
                  }
                  accessibilityState={{ expanded: props.composerTrayVisible }}
                  onPress={() => props.setComposerTrayVisible((current) => !current)}
                  style={({ pressed }) => [
                    styles.composerMenu,
                    props.composerTrayVisible && styles.composerMenuActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={props.composerTrayVisible ? "close" : "add"}
                    size={iconSize.navigation}
                    color={colors.text}
                  />
                </Pressable>
              )}
              <ComposerEditor
                voicePhase={props.voicePhase}
                composerScope={props.composerScope}
                getTransferAccess={props.getTransferAccess}
                getStableTransferAccess={props.getStableTransferAccess}
                composerInputRef={props.composerInputRef}
                fileAttachmentEnabled={props.fileAttachmentEnabled}
                pastedAttachmentPending={props.pastedAttachmentPending}
                attachments={props.attachments}
                handleComposerLargePaste={props.handleComposerLargePaste}
                draft={props.draft}
                handleComposerTextChange={props.handleComposerTextChange}
                handleComposerMarkdownChange={props.handleComposerMarkdownChange}
                draftSelectionRef={props.draftSelectionRef}
                pendingVoiceSelection={props.pendingVoiceSelection}
                voiceController={props.voiceController}
                searchComposerSuggestions={props.searchComposerSuggestions}
                selectComposerMention={props.selectComposerMention}
                editingQueuedMessage={props.editingQueuedMessage}
                voiceBackend={props.voiceBackend}
                voiceResource={props.voiceResource}
              />
              <ComposerMicrophone
                microphoneButtonRef={props.microphoneButtonRef}
                editingQueuedMessage={props.editingQueuedMessage}
                voicePhase={props.voicePhase}
                voiceRetryAvailable={props.voiceRetryAvailable}
                retryVoice={props.retryVoice}
                toggleVoice={props.toggleVoice}
                finishVoice={props.finishVoice}
                microphoneAccess={props.microphoneAccess}
              />
              <ComposerSubmitAction
                editingQueuedMessage={props.editingQueuedMessage}
                sendDisabled={props.sendDisabled}
                composerDiscardEnabled={props.composerDiscardEnabled}
                queuedComposerEditBusy={props.queuedComposerEditBusy}
                discardComposer={props.discardComposer}
                steerComposer={props.steerComposer}
                activatePrimaryAction={props.activatePrimaryAction}
                deliveryActions={props.deliveryActions}
                dismissComposerKeyboardForOverlay={props.dismissComposerKeyboardForOverlay}
                handleDeliveryAction={props.handleDeliveryAction}
                voicePhase={props.voicePhase}
                stoppingResponse={props.stoppingResponse}
                threadLifecycleActive={props.threadLifecycleActive}
                currentTurnId={props.currentTurnId}
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

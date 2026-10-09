import { ScrollView } from "react-native";
import { styles } from "./ComposerContextStrip.styles";
import type { ComposerFeatureProps } from "./ComposerFeatureContract";
import { ComposerControlChips } from "./settings/ComposerControlChips";

type Props = Pick<
  ComposerFeatureProps,
  | "applyModelSettings"
  | "newChat"
  | "workspaceResources"
  | "controlsResourceId"
  | "cwd"
  | "remoteThread"
  | "readOnly"
  | "selectedModel"
  | "selectedEffort"
  | "selectedServiceTier"
  | "selectedPersonality"
  | "selectedPermissions"
  | "controlError"
  | "onLoadControls"
  | "openQuickControlMenu"
  | "closeQuickControlMenu"
  | "openControls"
  | "selectPermissions"
  | "toolContextChips"
  | "leadingContextChips"
>;
export function ComposerContextStrip({
  applyModelSettings,
  closeQuickControlMenu,
  controlError,
  controlsResourceId,
  cwd,
  leadingContextChips,
  newChat,
  onLoadControls,
  openControls,
  openQuickControlMenu,
  readOnly,
  remoteThread,
  selectedEffort,
  selectedModel,
  selectedPermissions,
  selectedPersonality,
  selectedServiceTier,
  selectPermissions,
  toolContextChips,
  workspaceResources,
}: Props): React.JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={styles.composerContextContent}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.composerContextStrip}
      testID="composer-context-strip"
    >
      {leadingContextChips}
      <ComposerControlChips
        cwd={cwd}
        error={controlError}
        newChat={newChat}
        onApplySettings={applyModelSettings}
        readOnly={readOnly}
        remoteThread={remoteThread}
        resourceId={controlsResourceId}
        resources={workspaceResources}
        selectedEffort={selectedEffort}
        selectedModel={selectedModel}
        selectedPermissions={selectedPermissions}
        selectedPersonality={selectedPersonality}
        selectedServiceTier={selectedServiceTier}
        {...(onLoadControls === undefined ? {} : { load: onLoadControls })}
        onClose={closeQuickControlMenu}
        onFallback={openControls}
        onQuickOpen={openQuickControlMenu}
        onSelectPermissions={selectPermissions}
      />
      {toolContextChips}
    </ScrollView>
  );
}

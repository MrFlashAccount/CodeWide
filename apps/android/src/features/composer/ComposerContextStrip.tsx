import { ScrollView } from "react-native";
import { styles } from "./ComposerContextStrip.styles";
import type { ComposerFeatureProps } from "./ComposerFeatureContract";
import { ComposerControlChips } from "./settings/ComposerControlChips";

type Props = Pick<
  ComposerFeatureProps,
  | "newChat"
  | "workspaceResources"
  | "controlsResourceId"
  | "cwd"
  | "remoteThread"
  | "readOnly"
  | "selectedModel"
  | "selectedEffort"
  | "selectedPersonality"
  | "selectedPermissions"
  | "controlError"
  | "onLoadControls"
  | "openQuickControlMenu"
  | "closeQuickControlMenu"
  | "openControls"
  | "selectModel"
  | "selectEffort"
  | "setSelectedPersonality"
  | "selectPermissions"
  | "toolContextChips"
>;
export function ComposerContextStrip({
  newChat,
  workspaceResources,
  controlsResourceId,
  cwd,
  remoteThread,
  readOnly,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  controlError,
  onLoadControls,
  openQuickControlMenu,
  closeQuickControlMenu,
  openControls,
  selectModel,
  selectEffort,
  setSelectedPersonality,
  selectPermissions,
  toolContextChips,
}: Props) {
  return (
    <ScrollView
      testID="composer-context-strip"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.composerContextStrip}
      contentContainerStyle={styles.composerContextContent}
    >
      <ComposerControlChips
        newChat={newChat}
        resources={workspaceResources}
        resourceId={controlsResourceId}
        cwd={cwd}
        remoteThread={remoteThread}
        readOnly={readOnly}
        selectedModel={selectedModel}
        selectedEffort={selectedEffort}
        selectedPersonality={selectedPersonality}
        selectedPermissions={selectedPermissions}
        error={controlError}
        {...(onLoadControls === undefined ? {} : { load: onLoadControls })}
        onQuickOpen={openQuickControlMenu}
        onClose={closeQuickControlMenu}
        onFallback={openControls}
        onSelectModel={selectModel}
        onSelectEffort={selectEffort}
        onSelectPersonality={setSelectedPersonality}
        onSelectPermissions={selectPermissions}
      />
      {toolContextChips}
    </ScrollView>
  );
}

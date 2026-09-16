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
  closeQuickControlMenu,
  controlError,
  controlsResourceId,
  cwd,
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
  selectEffort,
  selectModel,
  selectPermissions,
  setSelectedPersonality,
  toolContextChips,
  workspaceResources,
}: Props) {
  return (
    <ScrollView
      contentContainerStyle={styles.composerContextContent}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.composerContextStrip}
      testID="composer-context-strip"
    >
      <ComposerControlChips
        cwd={cwd}
        error={controlError}
        newChat={newChat}
        readOnly={readOnly}
        remoteThread={remoteThread}
        resourceId={controlsResourceId}
        resources={workspaceResources}
        selectedEffort={selectedEffort}
        selectedModel={selectedModel}
        selectedPermissions={selectedPermissions}
        selectedPersonality={selectedPersonality}
        {...(onLoadControls === undefined ? {} : { load: onLoadControls })}
        onClose={closeQuickControlMenu}
        onFallback={openControls}
        onQuickOpen={openQuickControlMenu}
        onSelectEffort={selectEffort}
        onSelectModel={selectModel}
        onSelectPermissions={selectPermissions}
        onSelectPersonality={setSelectedPersonality}
      />
      {toolContextChips}
    </ScrollView>
  );
}

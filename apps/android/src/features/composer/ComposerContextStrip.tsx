import { ScrollView } from "react-native";
import { styles } from "./ComposerContextStrip.styles";
import type { ComposerFeatureProps } from "./ComposerFeatureContract";
import { ComposerControlChips } from "./settings/ComposerControlChips";

type Props = Pick<
  ComposerFeatureProps,
  | "applyModelSettings"
  | "catalogControls"
  | "controls$"
  | "newChat"
  | "workspaceResources"
  | "controlsResourceId"
  | "cwd"
  | "detailCursor"
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
  catalogControls,
  closeQuickControlMenu,
  controlError,
  controls$,
  controlsResourceId,
  cwd,
  detailCursor,
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
        catalogControls={catalogControls ?? null}
        controls$={controls$}
        cwd={cwd}
        detailCursor={detailCursor ?? 0}
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

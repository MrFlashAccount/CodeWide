import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ComposerContextStrip } from "./ComposerContextStrip";
import { styles } from "./ComposerFeature.styles";

/** The existing read-only dock publishes execution metadata without creating editor state. */
export function ReadOnlyComposerContext({
  children,
  thread,
}: {
  children: ReactNode;
  thread: Thread;
}) {
  return (
    <View style={styles.composerDock} testID="composer-dock">
      <ComposerContextStrip
        applyModelSettings={() => undefined}
        closeQuickControlMenu={() => undefined}
        controlError={null}
        controlsResourceId={null}
        cwd={thread.cwd}
        newChat={false}
        onLoadControls={undefined}
        openControls={() => undefined}
        openQuickControlMenu={() => undefined}
        readOnly
        remoteThread={thread}
        selectedEffort={null}
        selectedModel={null}
        selectedPermissions={null}
        selectedPersonality={null}
        selectedServiceTier={undefined}
        selectPermissions={() => undefined}
        toolContextChips={children}
        workspaceResources={null}
      />
    </View>
  );
}

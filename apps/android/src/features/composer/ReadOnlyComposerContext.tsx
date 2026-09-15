import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ComposerContextStrip } from "./ComposerContextStrip";
import { styles } from "./ComposerFeature.styles";

/** The existing read-only dock publishes execution metadata without creating editor state. */
export function ReadOnlyComposerContext({
  thread,
  children,
}: {
  thread: Thread;
  children: ReactNode;
}) {
  return (
    <View testID="composer-dock" style={styles.composerDock}>
      <ComposerContextStrip
        newChat={false}
        workspaceResources={null}
        controlsResourceId={null}
        cwd={thread.cwd}
        remoteThread={thread}
        readOnly
        selectedModel={null}
        selectedEffort={null}
        selectedPersonality={null}
        selectedPermissions={null}
        controlError={null}
        onLoadControls={undefined}
        openQuickControlMenu={() => undefined}
        closeQuickControlMenu={() => undefined}
        openControls={() => undefined}
        selectModel={() => undefined}
        selectEffort={() => undefined}
        setSelectedPersonality={() => undefined}
        selectPermissions={() => undefined}
        toolContextChips={children}
      />
    </View>
  );
}

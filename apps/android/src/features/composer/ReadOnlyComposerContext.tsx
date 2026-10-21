import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { LoadTurnControls } from "../../data/turn-controls-types";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { turnControlsResourceKey } from "../../data/workspace-resource-keys";
import { colors, iconSize } from "../../theme";
import { AppText } from "../../ui/AppText";
import { composerSlotStyles } from "../../ui/composerSlot.styles";
import { ComposerContextStrip } from "./ComposerContextStrip";
import { styles } from "./ComposerFeature.styles";

/**
 * The existing read-only dock publishes execution metadata without creating editor state.
 * It reads the editable composer's turn-controls catalog, so its disabled model and access
 * chips carry the same labels and icons, and a locked bar takes the editor's place.
 */
export function ReadOnlyComposerContext({
  children,
  connectionId,
  loadControls,
  notice,
  thread,
  workspaceResources,
}: {
  children: ReactNode;
  connectionId: string;
  loadControls: LoadTurnControls | undefined;
  /** Why this conversation takes no input, shown where the editor would be. */
  notice: string;
  thread: Thread;
  workspaceResources: WorkspaceResourceDatabase | null;
}) {
  return (
    <View style={styles.composerDock} testID="composer-dock">
      <ComposerContextStrip
        applyModelSettings={() => undefined}
        closeQuickControlMenu={() => undefined}
        controlError={null}
        controls$={null}
        controlsResourceId={turnControlsResourceKey(connectionId, thread.cwd)}
        cwd={thread.cwd}
        newChat={false}
        onLoadControls={loadControls}
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
        workspaceResources={workspaceResources}
      />
      <ReadOnlyComposerNotice notice={notice} />
    </View>
  );
}

/** A locked, editor-shaped bar under the chips, so the dock keeps the composer's layout. */
function ReadOnlyComposerNotice({ notice }: { notice: string }) {
  return (
    <View style={composerSlotStyles.row}>
      <View
        accessibilityLabel={notice}
        accessible
        style={composerSlotStyles.pill}
        testID="readonly-composer-notice"
      >
        <Ionicons color={colors.textMuted} name="lock-closed-outline" size={iconSize.inline} />
        <AppText
          numberOfLines={1}
          style={[composerSlotStyles.label, composerSlotStyles.placeholder]}
        >
          {notice}
        </AppText>
      </View>
    </View>
  );
}

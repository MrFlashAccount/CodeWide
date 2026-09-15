/** V1 ComposerAccessoryTray owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ComposerAccessoryTray.styles";
import { type ComposerAccessoryAction } from "./composerTypes";

export const COMPOSER_ACCESSORY_ACTIONS: ReadonlyArray<{
  id: ComposerAccessoryAction;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { id: "files", icon: "attach-outline", label: "File" },
  { id: "drawing", icon: "brush-outline", label: "Drawing" },
  { id: "terminal", icon: "terminal-outline", label: "Terminal" },
  { id: "ports", icon: "git-network-outline", label: "Port forward" },
  { id: "skills", icon: "extension-puzzle-outline", label: "Skill" },
  { id: "goal", icon: "flag-outline", label: "Goal" },
];

export function ComposerAccessoryTray({
  fileEnabled,
  terminalEnabled,
  portForwardEnabled,
  onSelect,
}: {
  fileEnabled: boolean;
  terminalEnabled: boolean;
  portForwardEnabled: boolean;
  onSelect(action: ComposerAccessoryAction): void;
}) {
  const enabled = (action: ComposerAccessoryAction) =>
    action === "files" || action === "drawing"
      ? fileEnabled
      : action === "terminal"
        ? terminalEnabled
        : action !== "ports" || portForwardEnabled;
  return (
    <View
      testID="composer-accessory-tray"
      accessibilityLabel="Composer actions"
      style={styles.composerAccessoryTray}
    >
      {COMPOSER_ACCESSORY_ACTIONS.map((action) => {
        const actionEnabled = enabled(action.id);
        return (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: !actionEnabled }}
            disabled={!actionEnabled}
            onPress={() => onSelect(action.id)}
            style={({ pressed }) => [
              styles.composerAccessoryAction,
              pressed && styles.pressed,
              !actionEnabled && styles.disabled,
            ]}
          >
            <Ionicons name={action.icon} size={iconSize.action} color={colors.text} />
            <Text numberOfLines={1} style={styles.composerAccessoryLabel}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

import type { Dispatch, SetStateAction } from "react";
import { Platform } from "react-native";
import { useEvent } from "../../react/useEvent";
import { type ActionMenuItem } from "../../ui/ActionMenu";
type ComposerAccessoryCapabilities = {
  fileAttachmentEnabled: boolean;
  newChat: boolean;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  portForwardingConnectionId: string | null;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
  openComposerFeature(action: ComposerAccessoryAction): void;
};
export function useComposerAccessoryActions({
  fileAttachmentEnabled,
  newChat,
  draftConnectionId,
  draftThreadId,
  portForwardingConnectionId,
  setComposerTrayVisible,
  openComposerFeature,
}: ComposerAccessoryCapabilities) {
  const openAccessoryAction = useEvent((action: ComposerAccessoryAction) => {
    setComposerTrayVisible(false);
    openComposerFeature(action);
  });

  const useAnchoredComposerMenu = Platform.OS === "android";

  const anchoredComposerActions: ActionMenuItem[] = [
    { id: "files", label: "Attach file", icon: "attach-outline", disabled: !fileAttachmentEnabled },
    { id: "drawing", label: "Drawing", icon: "brush-outline", disabled: !fileAttachmentEnabled },
    {
      id: "terminal",
      label: "Terminal",
      icon: "terminal-outline",
      disabled:
        newChat ||
        Platform.OS !== "android" ||
        draftConnectionId === null ||
        draftThreadId === null,
    },
    {
      id: "ports",
      label: "Port forward",
      icon: "git-network-outline",
      disabled: portForwardingConnectionId === null,
    },
    { id: "skills", label: "Skills", icon: "sparkles-outline" },
    { id: "goal", label: "Goal", icon: "flag-outline" },
  ];

  const handleAnchoredComposerAction = useEvent((id: string) => {
    if (
      id === "files" ||
      id === "drawing" ||
      id === "terminal" ||
      id === "ports" ||
      id === "skills" ||
      id === "goal"
    ) {
      openAccessoryAction(id);
    }
  });
  return {
    useAnchoredComposerMenu,
    anchoredComposerActions,
    handleAnchoredComposerAction,
    openAccessoryAction,
  };
}
